import { createHash, timingSafeEqual } from 'node:crypto';
import { exportPrivateKey, generateEd25519KeyPair, publicKeyToMultibase } from '@confer/identity';
import {
  AppError,
  encrypt,
  loginRequestSchema,
  newId,
  registerRequestSchema,
} from '@confer/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import * as jose from 'jose';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { agents, keypairs, sessions, users } from '../db/schema.js';
import { getEnv } from '../env.js';
import { getConfigValue } from '../lib/app-config.js';
import { uniqueViolation } from '../lib/db-errors.js';
import { userDid } from '../lib/public-identity.js';
import { authMiddleware, TOKEN_TYPE } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';

export const authRoutes = new Hono();

async function hashPassword(password: string): Promise<string> {
  const argon2 = await import('argon2');
  return argon2.hash(password);
}

async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const argon2 = await import('argon2');
  return argon2.verify(hash, password);
}

// Both tokens carry the session id (`sid`) so `/refresh` can consult the backing
// session (revoked on logout) and `/logout` can target the exact session row.
//
// They also carry `typ` — see `TOKEN_TYPE` in middleware/auth.ts for why.
async function issueTokens(userId: string, username: string, sessionId: string) {
  const env = getEnv();
  const secret = new TextEncoder().encode(env.JWT_SECRET);

  // A fresh `jti` per issuance makes every token byte-unique. Without it, two
  // issuances in the same wall-clock second are identical (JWT `iat` is
  // second-granular), so refresh rotation would be a silent no-op — the "new"
  // refresh token would equal the old one and its hash would still match.
  const sign = (typ: string, ttl: string) =>
    new jose.SignJWT({ username, sid: sessionId, typ })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti(newId())
      .setSubject(userId)
      .setIssuer(env.JWT_ISSUER)
      .setIssuedAt()
      .setExpirationTime(ttl)
      .sign(secret);

  const [accessToken, refreshToken] = await Promise.all([
    sign(TOKEN_TYPE.access, '15m'),
    sign(TOKEN_TYPE.refresh, '90d'),
  ]);

  return { accessToken, refreshToken, expiresIn: 900 };
}

// SHA-256 hex of a token. Refresh tokens are already high-entropy HMAC-signed
// JWTs, so a fast hash (not Argon2) is enough to avoid storing them in plaintext
// while still letting `/refresh` validate the presented token against the row.
function sha256Hex(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Constant-time compare of two equal-length hex digests. A length mismatch can
// only be a structural error (e.g. a legacy NULL hash), so short-circuiting it
// leaks nothing about the secret.
function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;

authRoutes.post('/register', rateLimit(3, 3600_000), async (c) => {
  // Honor the global registration switch before doing any work.
  const registrationOpen = await getConfigValue('registration_open');
  if (!registrationOpen) {
    throw new AppError('registration_closed', 'Registration is currently closed', 403);
  }

  const body = registerRequestSchema.parse(await c.req.json());
  const db = getDb();

  const existing = await db.select().from(users).where(eq(users.username, body.username)).limit(1);
  if (existing.length > 0) {
    throw new AppError('username_taken', 'Username is already taken', 409);
  }

  const userId = newId();
  const did = userDid(body.username);
  const passwordHash = await hashPassword(body.password);

  // The select above narrows the username race but cannot close it — the row it
  // does not find can be inserted before this one lands — and it says nothing
  // about `email`, which is unique too. The constraint is what actually decides,
  // so a violation is translated here rather than surfacing as a 500.
  const [user] = await db
    .insert(users)
    .values({
      id: userId,
      username: body.username,
      email: body.email,
      display_name: body.display_name,
      did,
      password_hash: passwordHash,
    })
    .returning()
    .catch((error) => {
      const constraint = uniqueViolation(error);
      if (constraint === 'users_username_unique' || constraint === 'users_did_unique') {
        throw new AppError('username_taken', 'Username is already taken', 409);
      }
      if (constraint === 'users_email_unique') {
        throw new AppError('email_taken', 'That email is already in use', 409);
      }
      throw error;
    });

  if (!user) {
    throw new AppError('user_creation_failed', 'Failed to create user', 500);
  }

  const agentId = newId();
  await db.insert(agents).values({
    id: agentId,
    user_id: userId,
    did: `${did}:agent`,
    name: `${body.display_name ?? body.username}'s Agent`,
  });

  const keyPair = await generateEd25519KeyPair();
  const pubMultibase = await publicKeyToMultibase(keyPair.publicKey);
  const privJwk = await exportPrivateKey(keyPair.privateKey);
  const env = getEnv();
  const encryptedKey = await encrypt(JSON.stringify(privJwk), env.ENCRYPTION_KEY);
  if (!encryptedKey.ok) {
    throw new AppError('encryption_failed', 'Failed to encrypt keypair', 500);
  }

  await db.insert(keypairs).values({
    id: newId(),
    owner_type: 'user',
    owner_id: userId,
    key_id: `${did}#key-1`,
    public_key_multibase: pubMultibase,
    private_key_jwk_encrypted: encryptedKey.value,
  });

  // Register gets a backing session too, so its freshly minted refresh token can
  // be rotated/revoked exactly like a login's (no more stranded, unrevocable
  // register tokens).
  const sessionId = newId();
  const tokens = await issueTokens(userId, body.username, sessionId);
  await db.insert(sessions).values({
    id: sessionId,
    user_id: userId,
    device_id: body.device_id,
    platform: body.device_info?.platform,
    refresh_token_hash: sha256Hex(tokens.refreshToken),
    last_active_at: new Date(),
    expires_at: new Date(Date.now() + REFRESH_TTL_MS),
  });

  return c.json(
    {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        display_name: user.display_name,
        did: user.did,
        role: user.role,
      },
    },
    201,
  );
});

authRoutes.post('/login', rateLimit(10, 60_000), async (c) => {
  const body = loginRequestSchema.parse(await c.req.json());
  const db = getDb();

  const [user] = await db.select().from(users).where(eq(users.username, body.username)).limit(1);

  if (!user?.password_hash) {
    throw new AppError('invalid_credentials', 'Invalid username or password', 401);
  }

  const valid = await verifyPassword(user.password_hash, body.password);
  if (!valid) {
    throw new AppError('invalid_credentials', 'Invalid username or password', 401);
  }

  if (user.status === 'disabled') {
    throw new AppError('account_disabled', 'This account has been disabled', 403);
  }

  const sessionId = newId();
  const tokens = await issueTokens(user.id, user.username, sessionId);

  await db.insert(sessions).values({
    id: sessionId,
    user_id: user.id,
    device_id: body.device_id,
    platform: body.device_info?.platform,
    refresh_token_hash: sha256Hex(tokens.refreshToken),
    last_active_at: new Date(),
    expires_at: new Date(Date.now() + REFRESH_TTL_MS),
  });

  return c.json({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_in: tokens.expiresIn,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      display_name: user.display_name,
      did: user.did,
      role: user.role,
    },
  });
});

const refreshRequestSchema = z.object({ refresh_token: z.string().min(1) });

// Rate-limited like the other credential endpoints. It was the one that wasn't,
// and it is the one that can delete a session on a failed attempt (reuse
// detection, below) — so an unauthenticated caller who learns a session id
// could hammer it. The limit is generous: a legitimate client refreshes about
// four times an hour.
authRoutes.post('/refresh', rateLimit(30, 60_000), async (c) => {
  const { refresh_token } = refreshRequestSchema.parse(await c.req.json());

  const env = getEnv();
  const secret = new TextEncoder().encode(env.JWT_SECRET);

  try {
    const { payload } = await jose.jwtVerify(refresh_token, secret, {
      issuer: env.JWT_ISSUER,
    });

    // Only a refresh token refreshes. Checked before the hash comparison below,
    // because that comparison treats a mismatch as token reuse and destroys the
    // session — so an access token presented here (a plausible client bug, and
    // a cheap way to log someone out) would have taken their session with it.
    if (payload.typ !== TOKEN_TYPE.refresh) {
      throw new AppError('unauthorized', 'Invalid or expired refresh token', 401);
    }

    // A disabled account must not be able to mint fresh tokens. Re-check status
    // on every refresh so disabling takes effect within one access-token cycle.
    const db = getDb();
    const [user] = await db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, payload.sub as string))
      .limit(1);
    if (!user || user.status === 'disabled') {
      throw new AppError('account_disabled', 'This account has been disabled', 403);
    }

    // A refresh token is only honored while its backing session still exists.
    // Logout deletes the session, so a logged-out token can no longer refresh —
    // this is what makes revocation real. A token minted before `sid` existed
    // (legacy) has no session to consult and is rejected, forcing a re-login.
    const sid = typeof payload.sid === 'string' ? payload.sid : undefined;
    if (!sid) {
      throw new AppError('unauthorized', 'Invalid or expired refresh token', 401);
    }
    const [session] = await db.select().from(sessions).where(eq(sessions.id, sid)).limit(1);
    if (!session) {
      throw new AppError('unauthorized', 'Invalid or expired refresh token', 401);
    }

    // The absolute lifetime of the session, as opposed to the lifetime of the
    // token presenting it. `expires_at` was written at login and never read
    // once, so it was a column, not a limit: every rotation minted a fresh 90-day
    // token, and a client that refreshed on a timer held a credential that could
    // not age out. Expiring here makes 90 days mean 90 days, and drops the row so
    // the sweep isn't left to a table that only ever grows.
    if (session.expires_at.getTime() <= Date.now()) {
      await db.delete(sessions).where(eq(sessions.id, sid));
      throw new AppError('unauthorized', 'Invalid or expired refresh token', 401);
    }

    // The presented token must hash to the one stored at issue/last-rotation.
    // A valid-looking token that doesn't match (e.g. a rotated-away token being
    // replayed) triggers reuse detection: drop the whole session so neither the
    // stale nor the current token can be used again.
    const presentedHash = sha256Hex(refresh_token);
    if (
      !session.refresh_token_hash ||
      !timingSafeEqualHex(presentedHash, session.refresh_token_hash)
    ) {
      await db.delete(sessions).where(eq(sessions.id, sid));
      throw new AppError('unauthorized', 'Invalid or expired refresh token', 401);
    }

    // Rotate: issue a new pair bound to the same session and store the new hash,
    // which invalidates the just-used refresh token on the next attempt.
    const tokens = await issueTokens(payload.sub as string, payload.username as string, sid);
    await db
      .update(sessions)
      .set({
        refresh_token_hash: sha256Hex(tokens.refreshToken),
        last_active_at: new Date(),
      })
      .where(eq(sessions.id, sid));

    return c.json({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('unauthorized', 'Invalid or expired refresh token', 401);
  }
});

authRoutes.post('/logout', authMiddleware, async (c) => {
  const { sub, sid } = c.get('user');
  const db = getDb();
  if (sid) {
    // Revoke exactly this device's session.
    await db.delete(sessions).where(and(eq(sessions.user_id, sub), eq(sessions.id, sid)));
  } else {
    // Legacy access token minted before `sid` existed: fail safe toward
    // revocation by clearing every session this user holds.
    await db.delete(sessions).where(eq(sessions.user_id, sub));
  }
  return c.json({ ok: true });
});
