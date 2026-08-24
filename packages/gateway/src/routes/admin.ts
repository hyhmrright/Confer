import {
  AppError,
  adminListQuerySchema,
  adminModerateSchema,
  adminUpdateAgentSchema,
  adminUpdateConfigSchema,
  adminUpdateUserSchema,
  adminUserListQuerySchema,
  newId,
} from '@confer/shared';
import { count, desc, eq, like, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { type Context, Hono } from 'hono';
import { getDb } from '../db/connection.js';
import {
  agents,
  auditLog,
  conversations,
  messages,
  peerContacts,
  sessions,
  users,
} from '../db/schema.js';
import { getAppConfig, setConfigValue } from '../lib/app-config.js';
import { adminMiddleware } from '../middleware/admin.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

export const adminRoutes = new Hono<AppEnv>();

// Identity first, then role — both gates apply to every /admin/* route.
adminRoutes.use('/*', authMiddleware);
adminRoutes.use('/*', adminMiddleware);

// The audit_log.ip_address column is Postgres `inet`; anything that is not a
// valid IPv4/IPv6 literal (e.g. a malformed proxy header) is dropped to null
// rather than failing the write.
function toInet(value: string | undefined): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim();
  if (!first) return null;
  const isIPv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(first);
  const isIPv6 = first.includes(':');
  return isIPv4 || isIPv6 ? first : null;
}

// Record an admin write action. Actor and client IP both come off the request
// context, so no call site has to remember to thread them through. Stores only
// ids/flags in details_json — never PII (per the forbidden list).
async function writeAudit(
  c: Context<AppEnv>,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  await getDb()
    .insert(auditLog)
    .values({
      id: newId(),
      user_id: c.get('user').sub,
      action,
      details_json: details,
      ip_address: toInet(c.req.header('x-forwarded-for') ?? undefined),
    });
}

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

// Count every row of a table (optionally filtered). Drizzle returns a one-row
// result set; this unwraps it so list handlers read as `total: await countOf(x)`.
async function countOf(table: PgTable, where?: SQL): Promise<number> {
  const [row] = await getDb().select({ value: count() }).from(table).where(where);
  return row?.value ?? 0;
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

  // Disabling revokes the target's sessions so refresh fails immediately.
  if (body.status === 'disabled') {
    await db.delete(sessions).where(eq(sessions.user_id, targetId));
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

// Hide or restore a conversation. Soft — never deletes data.
adminRoutes.patch('/conversations/:id', async (c) => {
  const targetId = c.req.param('id');
  const body = adminModerateSchema.parse(await c.req.json());
  const db = getDb();

  const [target] = await db
    .select({ moderation_status: conversations.moderation_status })
    .from(conversations)
    .where(eq(conversations.id, targetId))
    .limit(1);
  if (!target) {
    throw new AppError('conversation_not_found', 'Conversation not found', 404);
  }

  await db
    .update(conversations)
    .set({ moderation_status: body.moderation_status, updated_at: new Date() })
    .where(eq(conversations.id, targetId));

  await auditChange(c, {
    action: `admin.conversation.${body.moderation_status === 'hidden' ? 'hide' : 'restore'}`,
    targetId,
    before: target.moderation_status,
    after: body.moderation_status,
    reason: body.reason,
  });

  return c.json({ ok: true });
});

// Hide or restore a single message. Soft — never deletes data.
adminRoutes.patch('/messages/:id', async (c) => {
  const targetId = c.req.param('id');
  const body = adminModerateSchema.parse(await c.req.json());
  const db = getDb();

  const [target] = await db
    .select({ moderation_status: messages.moderation_status })
    .from(messages)
    .where(eq(messages.id, targetId))
    .limit(1);
  if (!target) {
    throw new AppError('message_not_found', 'Message not found', 404);
  }

  await db
    .update(messages)
    .set({ moderation_status: body.moderation_status, updated_at: new Date() })
    .where(eq(messages.id, targetId));

  await auditChange(c, {
    action: `admin.message.${body.moderation_status === 'hidden' ? 'hide' : 'restore'}`,
    targetId,
    before: target.moderation_status,
    after: body.moderation_status,
    reason: body.reason,
  });

  return c.json({ ok: true });
});

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
