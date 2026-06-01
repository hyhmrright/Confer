import { exportPrivateKey, generateEd25519KeyPair, publicKeyToMultibase } from '@confer/identity';
import {
  AppError,
  encrypt,
  loginRequestSchema,
  newId,
  registerRequestSchema,
} from '@confer/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import * as jose from 'jose';
import { getDb } from '../db/connection.js';
import { agents, keypairs, sessions, users } from '../db/schema.js';
import { getEnv } from '../env.js';
import { authMiddleware } from '../middleware/auth.js';
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

async function issueTokens(userId: string, username: string) {
  const env = getEnv();
  const secret = new TextEncoder().encode(env.JWT_SECRET);

  const accessToken = await new jose.SignJWT({ username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(env.JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);

  const refreshToken = await new jose.SignJWT({ username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(env.JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime('90d')
    .sign(secret);

  return { accessToken, refreshToken, expiresIn: 900 };
}

authRoutes.post('/register', rateLimit(3, 3600_000), async (c) => {
  const body = registerRequestSchema.parse(await c.req.json());
  const db = getDb();

  const existing = await db.select().from(users).where(eq(users.username, body.username)).limit(1);
  if (existing.length > 0) {
    throw new AppError('username_taken', 'Username is already taken', 409);
  }

  const userId = newId();
  const did = `did:web:localhost:agents:${body.username}`;
  const passwordHash = await hashPassword(body.password);

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
    .returning();

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

  const tokens = await issueTokens(userId, body.username);

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

  const tokens = await issueTokens(user.id, user.username);

  const sessionId = newId();
  await db.insert(sessions).values({
    id: sessionId,
    user_id: user.id,
    device_id: body.device_id,
    platform: body.device_info?.platform,
    last_active_at: new Date(),
    expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
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

authRoutes.post('/refresh', async (c) => {
  const { refresh_token } = await c.req.json();
  if (!refresh_token) {
    throw new AppError('invalid_request', 'refresh_token is required', 400);
  }

  const env = getEnv();
  const secret = new TextEncoder().encode(env.JWT_SECRET);

  try {
    const { payload } = await jose.jwtVerify(refresh_token, secret, {
      issuer: env.JWT_ISSUER,
    });

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

    const tokens = await issueTokens(payload.sub as string, payload.username as string);

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
  return c.json({ ok: true });
});
