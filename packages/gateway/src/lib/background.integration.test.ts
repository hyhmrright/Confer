import { beforeEach, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { getDb } from '../db/connection.js';
import { users } from '../db/schema.js';
import { resetDb } from '../test/helpers.js';
import { runDetached } from './background.js';

beforeEach(resetDb);

// The bug this guards against is not hypothetical and did not look like a bug:
// three CI failures in forty runs, a different test each time, because the
// victim is whichever test's `beforeEach` collided with the previous test's
// detached write. One of them left the stack trace that named it —
// `PostgresError: deadlock detected`, TRUNCATE waiting on AccessExclusiveLock
// against a query holding a RowShareLock.
//
// The delay is what makes it deterministic here: without the drain, resetDb
// truncates while the insert is still pending, the row lands afterwards, and
// the next test starts with data it never created.
test('resetDb drains detached work rather than truncating over it', async () => {
  let landed = false;
  const id = newId();

  runDetached(
    (async () => {
      await Bun.sleep(80);
      await getDb()
        .insert(users)
        .values({
          id,
          username: `bg${id.slice(-8).toLowerCase()}`,
          did: `did:web:localhost:${id}`,
        });
      landed = true;
    })(),
    (err) => {
      throw err;
    },
  );

  await resetDb();

  expect(landed).toBe(true); // the write finished before the truncate ran
  expect(await getDb().select().from(users)).toHaveLength(0); // and was truncated by it
});

test('a detached failure is reported to onError and still settles', async () => {
  let seen: unknown;
  runDetached(Promise.reject(new Error('boom')), (err) => {
    seen = err;
  });

  await resetDb(); // drains, so the rejection has been handled by now
  expect((seen as Error)?.message).toBe('boom');
});
