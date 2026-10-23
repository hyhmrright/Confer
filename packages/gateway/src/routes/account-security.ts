import {
  AppError,
  changePasswordRequestSchema,
  disableTwoFactorRequestSchema,
  enableTwoFactorRequestSchema,
} from '@confer/shared';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { sessions, users } from '../db/schema.js';
import { writeAudit } from '../lib/audit.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { openSecret, sealSecret } from '../lib/sealed.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../lib/totp.js';
import { consumeSecondFactor, newRecoveryCodes } from '../lib/two-factor.js';
import { authMiddleware, requireSession } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import type { AppEnv } from '../types.js';
import { disconnectOtherSessions } from '../ws/handler.js';

// The owner's own credentials: their password and two-step sign-in. Each change
// asks for proof of the credential it weakens, and lands in the audit log.
export const accountSecurityRoutes = new Hono<AppEnv>();

for (const path of ['/password', '/2fa', '/2fa/*']) {
  accountSecurityRoutes.use(path, authMiddleware, requireSession);
}
// Every route here checks a password or a code; the cap is per account.
const guessLimit = rateLimit<AppEnv>(10, 60_000, {
  keyBy: (c) => `account-security:${c.get('user').sub}`,
});

async function loadUser(userId: string): Promise<typeof users.$inferSelect> {
  const [user] = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError('not_found', 'User not found', 404);
  return user;
}

async function requirePassword(user: typeof users.$inferSelect, password: string): Promise<void> {
  if (!user.password_hash || !(await verifyPassword(user.password_hash, password))) {
    throw new AppError('invalid_credentials', 'The password is not correct', 401);
  }
}

/**
 * Sign out every session but the caller's, sockets included. Both changes that
 * call this are usually "someone else may have got in".
 */
async function revokeOtherSessions(userId: string, sid: string | undefined): Promise<void> {
  await getDb()
    .delete(sessions)
    .where(
      sid ? and(eq(sessions.user_id, userId), ne(sessions.id, sid)) : eq(sessions.user_id, userId),
    );
  disconnectOtherSessions(userId, sid);
}

accountSecurityRoutes.post('/password', guessLimit, async (c) => {
  const { sub, sid } = c.get('user');
  const body = changePasswordRequestSchema.parse(await c.req.json());
  const user = await loadUser(sub);
  await requirePassword(user, body.current_password);
  // With two-step sign-in on, a phished password plus a stolen token must not
  // be enough to take the account — the change keeps the caller's session.
  if (user.totp_enabled_at) await consumeSecondFactor(user, body);

  await getDb()
    .update(users)
    .set({ password_hash: await hashPassword(body.new_password), updated_at: new Date() })
    .where(eq(users.id, sub));
  await revokeOtherSessions(sub, sid);
  await writeAudit(c, 'account.password_changed', {});
  return c.json({ ok: true });
});

accountSecurityRoutes.get('/2fa', async (c) => {
  const user = await loadUser(c.get('user').sub);
  return c.json({
    enabled: user.totp_enabled_at !== null,
    recovery_codes_left: ((user.totp_recovery_json as string[] | null) ?? []).length,
  });
});

// Start turning it on: a new secret, kept but not yet enforced, for the owner
// to add to their app. Starting again replaces an unfinished one.
accountSecurityRoutes.post('/2fa/setup', async (c) => {
  const user = await loadUser(c.get('user').sub);
  if (user.totp_enabled_at) {
    throw new AppError('already_enabled', 'Two-step sign-in is already on', 409);
  }
  const secret = generateTotpSecret();
  // Conditional on it still being off: a setup racing an enable must not swap
  // the secret out from under an account that has just turned it on.
  const written = await getDb()
    .update(users)
    .set({ totp_secret_json: await sealSecret(secret), totp_last_step: null })
    .where(and(eq(users.id, user.id), isNull(users.totp_enabled_at)))
    .returning({ id: users.id });
  if (written.length === 0) {
    throw new AppError('already_enabled', 'Two-step sign-in is already on', 409);
  }
  return c.json({ secret, otpauth_uri: otpauthUri(secret, user.username, 'Confer') });
});

// Finish turning it on, proving the app has the secret. The recovery codes are
// returned this once; only their hashes are kept.
accountSecurityRoutes.post('/2fa/enable', guessLimit, async (c) => {
  const { sub, sid } = c.get('user');
  const { password, code } = enableTwoFactorRequestSchema.parse(await c.req.json());
  const user = await loadUser(sub);
  await requirePassword(user, password);
  if (user.totp_enabled_at) {
    throw new AppError('already_enabled', 'Two-step sign-in is already on', 409);
  }
  if (!user.totp_secret_json) {
    throw new AppError('setup_required', 'Start setup first', 409);
  }
  const step = verifyTotp(await openSecret(user.totp_secret_json), code, Date.now(), null);
  if (step === null) throw new AppError('invalid_second_factor', 'That code is not valid', 401);

  const { codes, hashes } = newRecoveryCodes();
  // Only the secret this code was checked against, and only while still off:
  // a concurrent setup or enable must not be overwritten half-way.
  const enabled = await getDb()
    .update(users)
    .set({ totp_enabled_at: new Date(), totp_last_step: step, totp_recovery_json: hashes })
    .where(
      and(
        eq(users.id, user.id),
        isNull(users.totp_enabled_at),
        eq(users.totp_secret_json, user.totp_secret_json),
      ),
    )
    .returning({ id: users.id });
  if (enabled.length === 0) throw new AppError('setup_changed', 'Setup changed; start again', 409);
  // Turned on because something felt wrong is the usual case; an intruder's
  // session should not outlive it.
  await revokeOtherSessions(sub, sid);
  await writeAudit(c, 'account.2fa_enabled', {});
  return c.json({ recovery_codes: codes });
});

// Turning it off takes both factors: the password alone is exactly what
// two-step sign-in exists to be more than.
accountSecurityRoutes.post('/2fa/disable', guessLimit, async (c) => {
  const body = disableTwoFactorRequestSchema.parse(await c.req.json());
  const user = await loadUser(c.get('user').sub);
  if (!user.totp_enabled_at) throw new AppError('not_enabled', 'Two-step sign-in is off', 409);
  await requirePassword(user, body.password);
  await consumeSecondFactor(user, body);

  await getDb()
    .update(users)
    .set({
      totp_secret_json: null,
      totp_enabled_at: null,
      totp_last_step: null,
      totp_recovery_json: null,
    })
    .where(eq(users.id, user.id));
  await writeAudit(c, 'account.2fa_disabled', {});
  return c.json({ ok: true });
});
