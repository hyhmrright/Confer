import { AppError } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import * as jose from 'jose';
import { getDb } from '../db/connection.js';
import { users } from '../db/schema.js';
import { getEnv } from '../env.js';

// What a token is for. Access and refresh differed only in `exp` — same issuer,
// same subject, same claims, same secret — so each was accepted wherever the
// other was, and the 15-minute access lifetime the session design rests on was
// a property of a value nobody had to present. Both ends check it: bearer auth
// admits only `access`, `/refresh` only `refresh`.
//
// It lives here rather than beside the minting code in `routes/auth.ts` because
// that file already imports this one — the other direction would be a cycle,
// and a route is the wrong owner for a rule the middleware enforces.
export const TOKEN_TYPE = { access: 'access', refresh: 'refresh' } as const;

export interface AuthPayload {
  sub: string;
  username: string;
  // Session id from the token, used by `/logout` to revoke the exact session.
  // Absent on legacy tokens minted before session revocation existed.
  sid?: string;
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
  let sid: string | undefined;
  try {
    const { payload } = await jose.jwtVerify(token, secret, {
      issuer: env.JWT_ISSUER,
    });
    // Only an access token authenticates a request. The two kinds were
    // indistinguishable — identical claims, identical secret, differing only in
    // `exp` — so a refresh token was a bearer credential for every route here,
    // good for 90 days. The short access lifetime only limits anything if the
    // long-lived token is refused at this door.
    if (payload.typ !== TOKEN_TYPE.access) {
      throw new AppError('unauthorized', 'Invalid or expired token', 401);
    }
    sub = payload.sub as string;
    username = payload.username as string;
    sid = typeof payload.sid === 'string' ? payload.sid : undefined;
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

  c.set('user', { sub, username, sid });

  await next();
});
