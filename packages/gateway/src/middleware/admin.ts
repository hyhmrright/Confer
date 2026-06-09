import { AppError } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { getDb } from '../db/connection.js';
import { users } from '../db/schema.js';
import type { AppEnv } from '../types.js';

// Server-side admin check. The role is read from the DB (the trusted source) on
// each call — never from a client-supplied value — so role changes, including
// demoting a compromised admin, take effect immediately. Reused by both the
// /admin/* gate below and per-route operator branches (e.g. errands) that admit
// admins without gating the whole router.
export async function isAdminUser(userId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.role === 'admin';
}

// Role guard for /api/v1/admin/*. Runs after authMiddleware (which already
// rejected disabled accounts and set c.get('user')). Non-admins get a 403.
export const adminMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const { sub } = c.get('user');
  if (!(await isAdminUser(sub))) {
    throw new AppError('forbidden', 'Admin privileges required', 403);
  }
  await next();
});
