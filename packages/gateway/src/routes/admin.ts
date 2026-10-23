import {
  AppError,
  adminListQuerySchema,
  adminModerateSchema,
  adminUpdateAgentSchema,
  adminUpdateConfigSchema,
  adminUpdateUserSchema,
  adminUserListQuerySchema,
} from '@confer/shared';
import { and, desc, eq, isNotNull, like, sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { agents, conversations, messages, peerContacts, sessions, users } from '../db/schema.js';
import { getAppConfig, setConfigValue } from '../lib/app-config.js';
import { writeAudit } from '../lib/audit.js';
import { countOf } from '../lib/pagination.js';
import { adminMiddleware } from '../middleware/admin.js';
import { authMiddleware, requireSession } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';
import { disconnectUser } from '../ws/handler.js';

export const adminRoutes = new Hono<AppEnv>();

// Identity first, then role — both gates apply to every /admin/* route.
adminRoutes.use('/*', authMiddleware);
adminRoutes.use('/*', requireSession);
adminRoutes.use('/*', adminMiddleware);

// Every admin write is the same event: some field of some row went from
// `before` to `after`. Audit it only when it actually moved — a PATCH that
// re-applies the current value, or omits the field entirely, is a no-op rather
// than an auditable event. Named fields rather than positional because all five
// are strings — a swapped pair would silently write a wrong audit row.
async function auditChange(
  c: Context<AppEnv>,
  change: {
    action: string;
    targetId: string;
    before: string;
    after: string | undefined;
    reason: string | undefined;
  },
): Promise<void> {
  if (change.after === undefined || change.after === change.before) return;
  await writeAudit(c, change.action, {
    target_id: change.targetId,
    before: change.before,
    after: change.after,
    reason: change.reason,
  });
}

adminRoutes.get('/users', async (c) => {
  const query = adminUserListQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const db = getDb();

  const where = query.q ? like(users.username, `%${query.q}%`) : undefined;
  const offset = (query.page - 1) * query.page_size;

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      display_name: users.display_name,
      email: users.email,
      role: users.role,
      status: users.status,
      two_factor_enabled: sql<boolean>`${users.totp_enabled_at} is not null`,
      created_at: users.created_at,
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.created_at))
    .limit(query.page_size)
    .offset(offset);

  return c.json({
    users: rows,
    page: query.page,
    page_size: query.page_size,
    total: await countOf(users, where),
  });
});

adminRoutes.patch('/users/:id', async (c) => {
  const actor = c.get('user');
  const targetId = c.req.param('id');
  const body = adminUpdateUserSchema.parse(await c.req.json());
  const db = getDb();

  // Self-lockout guard: an admin must not demote or disable their own account,
  // otherwise they could lock themselves (and possibly the last admin) out.
  if (targetId === actor.sub) {
    throw new AppError(
      'self_modification_forbidden',
      'You cannot change your own role or status',
      400,
    );
  }

  const [target] = await db
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1);
  if (!target) {
    throw new AppError('user_not_found', 'User not found', 404);
  }

  const updates: { role?: string; status?: string; updated_at: Date } = { updated_at: new Date() };
  if (body.role !== undefined) updates.role = body.role;
  if (body.status !== undefined) updates.status = body.status;

  await db.update(users).set(updates).where(eq(users.id, targetId));

  // Disabling revokes the target's sessions so refresh fails immediately, and
  // drops the sockets those sessions are holding — a live socket outlives the
  // row it was authorized by, and /ws is proxied with a one-day read timeout.
  if (body.status === 'disabled') {
    await db.delete(sessions).where(eq(sessions.user_id, targetId));
    disconnectUser(targetId);
  }

  await auditChange(c, {
    action: 'admin.user.role',
    targetId,
    before: target.role,
    after: body.role,
    reason: body.reason,
  });
  await auditChange(c, {
    action: `admin.user.${body.status === 'disabled' ? 'disable' : 'enable'}`,
    targetId,
    before: target.status,
    after: body.status,
    reason: body.reason,
  });

  return c.json({ ok: true });
});

// The way back for an owner who has lost both their authenticator and their
// recovery codes: an admin turns two-step sign-in off for them. Never for the
// admin's own account — from here it would need neither the password nor a
// code, which is exactly what turning it off is supposed to need.
adminRoutes.post('/users/:id/reset-2fa', async (c) => {
  const targetId = c.req.param('id');
  if (targetId === c.get('user').sub) {
    throw new AppError('self_modification_forbidden', 'Turn off your own in Settings', 400);
  }
  const [reset] = await getDb()
    .update(users)
    .set({
      totp_secret_json: null,
      totp_enabled_at: null,
      totp_last_step: null,
      totp_recovery_json: null,
    })
    .where(and(eq(users.id, targetId), isNotNull(users.totp_enabled_at)))
    .returning({ id: users.id });
  if (!reset) throw new AppError('not_enabled', 'Two-step sign-in is not on for this user', 404);
  await writeAudit(c, 'admin.user.reset_2fa', { target_id: targetId });
  return c.json({ ok: true });
});

adminRoutes.get('/stats', async (c) => {
  const [userCount, conversationCount, contactCount, messageCount] = await Promise.all([
    countOf(users),
    countOf(conversations),
    countOf(peerContacts),
    countOf(messages),
  ]);

  return c.json({
    users: userCount,
    conversations: conversationCount,
    contacts: contactCount,
    messages: messageCount,
  });
});

// --- 3b: content moderation -------------------------------------------------

// List all agents with moderation status. Admin-only — includes suspended.
adminRoutes.get('/agents', async (c) => {
  const query = adminListQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const db = getDb();
  const offset = (query.page - 1) * query.page_size;

  const rows = await db
    .select({
      id: agents.id,
      user_id: agents.user_id,
      name: agents.name,
      did: agents.did,
      is_public: agents.is_public,
      status: agents.status,
      created_at: agents.created_at,
    })
    .from(agents)
    .orderBy(desc(agents.created_at))
    .limit(query.page_size)
    .offset(offset);

  return c.json({
    agents: rows,
    page: query.page,
    page_size: query.page_size,
    total: await countOf(agents),
  });
});

// Suspend or restore an agent. Only flips agents.status — the AgentFacts/DID
// document is intentionally untouched (Contract 3 stays clear). Read-path
// filtering hides suspended agents from public discovery.
adminRoutes.patch('/agents/:id', async (c) => {
  const targetId = c.req.param('id');
  const body = adminUpdateAgentSchema.parse(await c.req.json());
  const db = getDb();

  const [target] = await db
    .select({ id: agents.id, status: agents.status })
    .from(agents)
    .where(eq(agents.id, targetId))
    .limit(1);
  if (!target) {
    throw new AppError('agent_not_found', 'Agent not found', 404);
  }

  await db
    .update(agents)
    .set({ status: body.status, updated_at: new Date() })
    .where(eq(agents.id, targetId));

  await auditChange(c, {
    action: `admin.agent.${body.status === 'suspended' ? 'suspend' : 'restore'}`,
    targetId,
    before: target.status,
    after: body.status,
    reason: body.reason,
  });

  return c.json({ ok: true });
});

// List recent conversations (admin sees hidden too).
adminRoutes.get('/conversations', async (c) => {
  const query = adminListQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const db = getDb();
  const offset = (query.page - 1) * query.page_size;

  const rows = await db
    .select({
      id: conversations.id,
      type: conversations.type,
      name: conversations.name,
      created_by: conversations.created_by,
      moderation_status: conversations.moderation_status,
      created_at: conversations.created_at,
      updated_at: conversations.updated_at,
    })
    .from(conversations)
    .orderBy(desc(conversations.updated_at))
    .limit(query.page_size)
    .offset(offset);

  return c.json({
    conversations: rows,
    page: query.page,
    page_size: query.page_size,
    total: await countOf(conversations),
  });
});

// Hide or restore a conversation or a single message. Soft — never deletes
// data. The two differ only in which table the flag lives on.
for (const { noun, label, table } of [
  { noun: 'conversation', label: 'Conversation', table: conversations },
  { noun: 'message', label: 'Message', table: messages },
] as const) {
  adminRoutes.patch(`/${noun}s/:id`, async (c) => {
    const targetId = c.req.param('id');
    const body = adminModerateSchema.parse(await c.req.json());
    const db = getDb();

    const [target] = await db
      .select({ moderation_status: table.moderation_status })
      .from(table)
      .where(eq(table.id, targetId))
      .limit(1);
    if (!target) {
      throw new AppError(`${noun}_not_found`, `${label} not found`, 404);
    }

    await db
      .update(table)
      .set({ moderation_status: body.moderation_status, updated_at: new Date() })
      .where(eq(table.id, targetId));

    await auditChange(c, {
      action: `admin.${noun}.${body.moderation_status === 'hidden' ? 'hide' : 'restore'}`,
      targetId,
      before: target.moderation_status,
      after: body.moderation_status,
      reason: body.reason,
    });

    return c.json({ ok: true });
  });
}

// --- 3c: global config ------------------------------------------------------

adminRoutes.get('/config', async (c) => {
  const config = await getAppConfig();
  return c.json({ config });
});

adminRoutes.patch('/config', async (c) => {
  const body = adminUpdateConfigSchema.parse(await c.req.json());

  const before = await getAppConfig();

  if (body.registration_open !== undefined) {
    await setConfigValue('registration_open', body.registration_open);
  }
  if (body.instance_name !== undefined) {
    await setConfigValue('instance_name', body.instance_name);
  }

  const after = await getAppConfig();

  await writeAudit(c, 'admin.config.update', { before, after });

  return c.json({ config: after });
});
