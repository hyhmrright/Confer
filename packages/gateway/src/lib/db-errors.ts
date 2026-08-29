// Postgres error codes we translate into API errors, so a collision the caller
// caused reads as a 409 rather than a 500.
//
// Nothing did this before, so `PATCH /users/me` with an address another account
// already holds — two people, one shared mailbox; or your own second account —
// came back "An unexpected error occurred". The write is correctly refused
// either way; what was wrong was telling the caller it was our fault.
//
// Checking the constraint name rather than pre-selecting is not an optimisation:
// a pre-select can only ever narrow the race, because the row it fails to find
// can be inserted before our own write lands. The constraint is the thing that
// actually decides, so it is the thing to ask.
const UNIQUE_VIOLATION = '23505';

/**
 * The unique constraint a failed write violated, or null if it failed some
 * other way. Names are Drizzle's (`users_email_unique`), which is what
 * `drizzle/*.sql` declares and therefore what Postgres reports.
 *
 * The `cause` walk is the whole of why this is a function rather than two
 * property reads. Drizzle does not rethrow the driver's error: it wraps it in a
 * `DrizzleQueryError` carrying the failed SQL, and the `PostgresError` with the
 * code and the constraint name is one `cause` down. Reading `error.code`
 * directly finds `undefined` and reports every collision as "not a unique
 * violation" — which is exactly what the first version of this did, and it
 * looked right in review because the shape it assumed is the shape the driver
 * throws. The wrapper is free to gain another layer, so this follows the chain
 * rather than reaching for `.cause` once.
 */
export function uniqueViolation(error: unknown): string | null {
  for (let e: unknown = error, depth = 0; e && typeof e === 'object' && depth < 5; depth++) {
    const candidate = e as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (candidate.code === UNIQUE_VIOLATION) {
      return typeof candidate.constraint_name === 'string' ? candidate.constraint_name : '';
    }
    e = candidate.cause;
  }
  return null;
}
