import { AppError } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import * as jose from 'jose';
import { getDb } from '../db/connection.js';
import { users } from '../db/schema.js';
import { getEnv } from '../env.js';

export interface AuthPayload {
  sub: string;
  username: string;
}

export const authMiddleware = createMiddleware<{
  Variables: { user: AuthPayload };
}>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new AppError('unauthorized', 'Missing or invalid authorization header', 401);
  }

  const token = header.slice(7);
  const env = getEnv();
  const secret = new TextEncoder().encode(env.JWT_SECRET);

  let sub: string;
  let username: string;
  try {
    const { payload } = await jose.jwtVerify(token, secret, {
      issuer: env.JWT_ISSUER,
    });
    sub = payload.sub as string;
    username = payload.username as string;
  } catch {
    throw new AppError('unauthorized', 'Invalid or expired token', 401);
  }

  // A disabled account must be rejected immediately even while it still holds a
  // valid (unexpired) access token. A single PK lookup is the cheapest way to
  // enforce this on every authenticated request.
  const db = getDb();
  const [row] = await db
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, sub))
    .limit(1);
  if (!row) {
    throw new AppError('unauthorized', 'Invalid or expired token', 401);
  }
  if (row.status === 'disabled') {
    throw new AppError('account_disabled', 'This account has been disabled', 403);
  }

  c.set('user', { sub, username });

  await next();
});
