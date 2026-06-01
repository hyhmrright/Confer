import { AppError, adminUpdateUserSchema, adminUserListQuerySchema, newId } from '@confer/shared';
import { count, desc, eq, like } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { auditLog, conversations, messages, peerContacts, sessions, users } from '../db/schema.js';
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

// Record an admin write action. Stores only ids/flags in details_json — never
// PII (per the forbidden list).
async function writeAudit(
  actorId: string,
  action: string,
  ip: string | undefined,
  details: Record<string, unknown>,
): Promise<void> {
  await getDb()
    .insert(auditLog)
    .values({
      id: newId(),
      user_id: actorId,
      action,
      details_json: details,
      ip_address: toInet(ip),
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
      created_at: users.created_at,
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.created_at))
    .limit(query.page_size)
    .offset(offset);

  const [totalRow] = await db.select({ value: count() }).from(users).where(where);

  return c.json({
    users: rows,
    page: query.page,
    page_size: query.page_size,
    total: totalRow?.value ?? 0,
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

  const ip = c.req.header('x-forwarded-for') ?? undefined;
  if (body.role !== undefined && body.role !== target.role) {
    await writeAudit(actor.sub, 'admin.user.role', ip, {
      target_id: targetId,
      before: target.role,
      after: body.role,
      reason: body.reason,
    });
  }
  if (body.status !== undefined && body.status !== target.status) {
    await writeAudit(
      actor.sub,
      `admin.user.${body.status === 'disabled' ? 'disable' : 'enable'}`,
      ip,
      {
        target_id: targetId,
        before: target.status,
        after: body.status,
        reason: body.reason,
      },
    );
  }

  return c.json({ ok: true });
});

adminRoutes.get('/stats', async (c) => {
  const db = getDb();

  const [u, conv, contact, msg] = await Promise.all([
    db.select({ value: count() }).from(users),
    db.select({ value: count() }).from(conversations),
    db.select({ value: count() }).from(peerContacts),
    db.select({ value: count() }).from(messages),
  ]);

  return c.json({
    users: u[0]?.value ?? 0,
    conversations: conv[0]?.value ?? 0,
    contacts: contact[0]?.value ?? 0,
    messages: msg[0]?.value ?? 0,
  });
});
