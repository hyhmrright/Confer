// Work a request starts and deliberately does not wait for: memory extraction
// after a turn, an agent turn resumed by a permission approval, document
// ingestion. Detaching is correct — the reply must not wait on it, and its
// failure must not fail the reply — but `void work.catch(log)` also throws the
// promise away, and a promise nobody holds is a promise nobody can wait for.
//
// That is fine in production and is a race in tests. `beforeEach(resetDb)`
// truncates every table between tests, and TRUNCATE takes an ACCESS EXCLUSIVE
// lock on each one: against a detached INSERT still running from the previous
// test it either deadlocks (Postgres reports 40P01 after its 1s
// deadlock_timeout) or queues behind it until the test times out. Three CI
// failures in forty runs, a different victim each time — the victim is whoever
// happens to be starting, which is why it read as flakiness rather than a bug.
// Truncating late is not the only damage: work that lands *after* the truncate
// leaves rows in the next test's tables, and that one fails an assertion
// instead of erroring.
//
// So the work stays detached and the promise is kept, which gives tests a join
// point. Nothing else about it changes.
const inFlight = new Set<Promise<unknown>>();

/**
 * Start `work` detached, handling failures through `onError`. An async
 * `onError` is awaited too — a handler that writes the failure to the database
 * is itself work that must finish before a truncate.
 */
export function runDetached(
  work: Promise<unknown>,
  onError: (err: unknown) => void | Promise<void>,
): void {
  const tracked = work.catch(onError).finally(() => inFlight.delete(tracked));
  inFlight.add(tracked);
}

/**
 * Await everything currently detached. The loop is for work that starts more
 * work while we wait; `runDetached` removes each promise as it settles, so an
 * empty set means quiet. Test-only — nothing in a request path should wait.
 */
export async function settleDetached(): Promise<void> {
  while (inFlight.size > 0) await Promise.all(inFlight);
}
