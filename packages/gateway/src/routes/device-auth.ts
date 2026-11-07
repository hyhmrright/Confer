import { randomBytes } from 'node:crypto';
import { AppError, newId } from '@confer/shared';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { apiTokens, deviceAuthorizations, users } from '../db/schema.js';
import { hashApiToken, mintApiToken } from '../lib/api-tokens.js';
import { writeAudit } from '../lib/audit.js';
import { authMiddleware, requireSession } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import type { AppEnv } from '../types.js';

export const deviceAuthRoutes = new Hono<AppEnv>();
const codeInput = z.object({
  user_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-F0-9]{8}$/),
});
// Both public paths are throttled. No caller-selected redirect or callback URL.
deviceAuthRoutes.post('/start', rateLimit(5, 60_000), async (c) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(64) }).parse(await c.req.json());
  const deviceCode = randomBytes(32).toString('base64url');
  const code = randomBytes(4).toString('hex').toUpperCase();
  const db = getDb();
  await db.delete(deviceAuthorizations).where(lt(deviceAuthorizations.expires_at, new Date()));
  await db.insert(deviceAuthorizations).values({
    id: newId(),
    device_hash: hashApiToken(deviceCode),
    user_code: code,
    name,
    expires_at: new Date(Date.now() + 600_000),
  });
  return c.json(
    {
      device_code: deviceCode,
      user_code: code,
      verification_path: `/connect?code=${code}`,
      expires_in: 600,
      interval: 5,
    },
    201,
  );
});
deviceAuthRoutes.post('/token', rateLimit(30, 60_000), async (c) => {
  const { device_code } = z
    .object({ device_code: z.string().min(40).max(64) })
    .parse(await c.req.json());
  const result = await getDb().transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(deviceAuthorizations)
      .where(
        and(
          eq(deviceAuthorizations.device_hash, hashApiToken(device_code)),
          gt(deviceAuthorizations.expires_at, new Date()),
        ),
      )
      .for('update');
    if (!request)
      throw new AppError('expired_request', 'Device request expired or already consumed', 400);
    if (!request.user_id) return null;
    const [owner] = await tx.select().from(users).where(eq(users.id, request.user_id));
    if (!owner || owner.status === 'disabled')
      throw new AppError('unauthorized', 'Account unavailable', 403);
    const held = await tx
      .select({ id: apiTokens.id })
      .from(apiTokens)
      .where(eq(apiTokens.user_id, owner.id));
    if (held.length >= 20)
      throw new AppError('too_many_tokens', 'Revoke an existing API token first', 409);
    const minted = mintApiToken();
    await tx.insert(apiTokens).values({
      id: newId(),
      user_id: owner.id,
      name: request.name,
      token_hash: minted.hash,
      prefix: minted.prefix,
      expires_at: new Date(Date.now() + 90 * 86_400_000),
    });
    await tx.delete(deviceAuthorizations).where(eq(deviceAuthorizations.id, request.id));
    return { token: minted.token, username: owner.username, expires_in: 90 * 86_400 };
  });
  return result ? c.json(result) : c.json({ status: 'authorization_pending' }, 202);
});
// Preview and approval never trust a browser-supplied device name or owner id.
deviceAuthRoutes.use('/request', authMiddleware, requireSession);
deviceAuthRoutes.post('/request', rateLimit(10, 60_000), async (c) => {
  const { user_code } = codeInput.parse(await c.req.json());
  const [request] = await getDb()
    .select({ name: deviceAuthorizations.name, expires_at: deviceAuthorizations.expires_at })
    .from(deviceAuthorizations)
    .where(
      and(
        eq(deviceAuthorizations.user_code, user_code),
        isNull(deviceAuthorizations.user_id),
        gt(deviceAuthorizations.expires_at, new Date()),
      ),
    );
  if (!request) throw new AppError('not_found', 'Pending device request not found', 404);
  return c.json(request);
});
deviceAuthRoutes.use('/decide', authMiddleware, requireSession);
deviceAuthRoutes.post('/decide', rateLimit(10, 60_000), async (c) => {
  const body = codeInput.extend({ approve: z.boolean() }).parse(await c.req.json());
  const condition = and(
    eq(deviceAuthorizations.user_code, body.user_code),
    isNull(deviceAuthorizations.user_id),
    gt(deviceAuthorizations.expires_at, new Date()),
  );
  const changed = body.approve
    ? await getDb()
        .update(deviceAuthorizations)
        .set({ user_id: c.get('user').sub })
        .where(condition)
        .returning({ id: deviceAuthorizations.id })
    : await getDb()
        .delete(deviceAuthorizations)
        .where(condition)
        .returning({ id: deviceAuthorizations.id });
  if (!changed.length) throw new AppError('not_found', 'Pending device request not found', 404);
  await writeAudit(c, body.approve ? 'device.approved' : 'device.denied', {
    request_id: changed[0]?.id,
  });
  return c.json({ ok: true });
});
