import { AppError } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { getDb } from '../db/connection.js';
import { users } from '../db/schema.js';
import type { AppEnv } from '../types.js';

// Role guard for /api/v1/admin/*. Runs after authMiddleware (which already
// rejected disabled accounts and set c.get('user')). Looks up the current
// user's role from the DB on each request so role changes — including
// demoting a compromised admin — take effect immediately without waiting for
// a token to expire. Non-admins get a 403.
export const adminMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const { sub } = c.get('user');
  const db = getDb();

  const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, sub)).limit(1);

  if (row?.role !== 'admin') {
    throw new AppError('forbidden', 'Admin privileges required', 403);
  }

  await next();
});
