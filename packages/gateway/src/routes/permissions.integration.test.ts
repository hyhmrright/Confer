import { newId } from '@confer/shared';
import { beforeEach, describe, expect, test } from 'bun:test';
import { getDb } from '../db/connection.js';
import { permissions } from '../db/schema.js';
import { type SeededUser, get, post, resetDb, seedUser } from '../test/helpers.js';

let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

async function seedPending(userId: string): Promise<string> {
  const id = newId();
  await getDb().insert(permissions).values({
    id,
    user_id: userId,
    action: 'send_message',
    scope_json: {},
    level: 'L2',
  });
  return id;
}

describe('permissions', () => {
  test('requires authentication', async () => {
    expect((await get('/api/v1/permissions/pending')).status).toBe(401);
  });

  test('lists pending requests, then moves them to history once decided', async () => {
    const id = await seedPending(user.id);

    const pending = await get('/api/v1/permissions/pending', { token: user.token });
    expect((await pending.json()).permissions).toHaveLength(1);

    const decided = await post(`/api/v1/permissions/${id}/decide`, {
      token: user.token,
      body: { decision: 'allow_once', scope: 'peer' },
    });
    expect(decided.status).toBe(200);

    expect((await (await get('/api/v1/permissions/pending', { token: user.token })).json()).permissions).toHaveLength(0);
    expect((await (await get('/api/v1/permissions/history', { token: user.token })).json()).permissions).toHaveLength(1);
  });

  test('returns 404 deciding an unknown request', async () => {
    const res = await post('/api/v1/permissions/01HZZZZZZZZZZZZZZZZZZZZZZZ/decide', {
      token: user.token,
      body: { decision: 'deny', scope: 'global' },
    });
    expect(res.status).toBe(404);
  });

  test('scopes pending requests to their owner', async () => {
    await seedPending(user.id);
    const other = await seedUser();
    const res = await get('/api/v1/permissions/pending', { token: other.token });
    expect((await res.json()).permissions).toHaveLength(0);
  });
});
