import { createHmac, randomBytes } from 'node:crypto';
import { AppError } from '@confer/shared';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { users } from '../db/schema.js';
import { getEnv } from '../env.js';
import { openSecret } from './sealed.js';
import { base32Encode, verifyTotp } from './totp.js';

// The second step of signing in: an authenticator code, or one of the recovery
// codes handed out when two-step sign-in was turned on.

const RECOVERY_CODE_COUNT = 10;

// Recovery codes are compared without their dash and case, the way people
// retype them from paper. Keyed with the server's secret rather than plainly
// hashed: 50 bits survive guessing online, but a dumped table of bare SHA-256
// would fall to one offline pass for every account at once.
const normalise = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');
const hashCode = (code: string) =>
  createHmac('sha256', getEnv().ENCRYPTION_KEY).update(normalise(code)).digest('hex');

// Wrong codes per account. The login limit is per IP, so someone holding the
// password could spread guesses across addresses; this caps them per account.
// Process-local like the other limiters: the gateway is single-instance.
const FAILURE_LIMIT = 5;
const FAILURE_WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { count: number; since: number }>();

function assertNotLocked(userId: string): void {
  const entry = failures.get(userId);
  if (!entry) return;
  if (Date.now() - entry.since >= FAILURE_WINDOW_MS) {
    failures.delete(userId);
  } else if (entry.count >= FAILURE_LIMIT) {
    throw new AppError('too_many_attempts', 'Too many wrong codes. Try again later.', 429);
  }
}

function recordFailure(userId: string): AppError {
  const entry = failures.get(userId);
  if (entry && Date.now() - entry.since < FAILURE_WINDOW_MS) entry.count += 1;
  else failures.set(userId, { count: 1, since: Date.now() });
  return new AppError('invalid_second_factor', 'That code is not valid', 401);
}

/**
 * Ten fresh recovery codes (shown once) and the hashes kept in their place.
 * 50 random bits each: a fast hash is enough when the login route is
 * rate-limited and every code dies on first use.
 */
export function newRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { codes, hashes: codes.map(hashCode) };
}

export interface SecondFactor {
  totp_code?: string;
  recovery_code?: string;
}

/**
 * Check a second factor for a user with two-step sign-in on, and spend it: the
 * time step is recorded so the code cannot be replayed, or the recovery code
 * is struck off. Throws `totp_required` when none was offered and
 * `invalid_second_factor` when the one offered is wrong.
 */
export async function consumeSecondFactor(
  user: typeof users.$inferSelect,
  factor: SecondFactor,
): Promise<void> {
  if (!factor.recovery_code && !factor.totp_code) {
    throw new AppError('totp_required', 'A code from your authenticator app is required', 401);
  }
  assertNotLocked(user.id);
  const db = getDb();
  // Both spends are one conditional UPDATE, not a read and a write: two sign-ins
  // racing with the same code must not both get through.
  if (factor.recovery_code) {
    const presented = hashCode(factor.recovery_code);
    const spent = await db
      .update(users)
      .set({ totp_recovery_json: sql`${users.totp_recovery_json} - ${presented}::text` })
      .where(
        and(eq(users.id, user.id), sql`jsonb_exists(${users.totp_recovery_json}, ${presented})`),
      )
      .returning({ id: users.id });
    if (spent.length === 0) throw recordFailure(user.id);
    failures.delete(user.id);
    return;
  }
  const step = verifyTotp(
    await openSecret(user.totp_secret_json),
    factor.totp_code ?? '',
    Date.now(),
    user.totp_last_step,
  );
  if (step === null) throw recordFailure(user.id);
  const spent = await db
    .update(users)
    .set({ totp_last_step: step })
    .where(
      and(eq(users.id, user.id), or(isNull(users.totp_last_step), lt(users.totp_last_step, step))),
    )
    .returning({ id: users.id });
  if (spent.length === 0) throw recordFailure(user.id);
  failures.delete(user.id);
}
