import { beforeEach, describe, expect, test } from 'bun:test';
import { type SeededUser, del, get, patch, post, resetDb, seedUser } from '../test/helpers.js';

const BASE = '/api/v1/memories';
let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

describe('memories', () => {
  test('requires authentication', async () => {
    expect((await get(BASE)).status).toBe(401);
  });

  test('creates, lists, updates and deletes a memory', async () => {
    const created = await post(BASE, {
      token: user.token,
      body: { title: 'Note', content: 'Body text', tags: ['a'] },
    });
    expect(created.status).toBe(201);
    const { memory } = await created.json();
    expect(memory).toMatchObject({ title: 'Note', content: 'Body text', user_id: user.id });

    const listed = await get(BASE, { token: user.token });
    expect((await listed.json()).memories).toHaveLength(1);

    const updated = await patch(`${BASE}/${memory.id}`, {
      token: user.token,
      body: { pinned: true },
    });
    expect(updated.status).toBe(200);
    expect((await updated.json()).memory.pinned).toBe(true);

    const removed = await del(`${BASE}/${memory.id}`, { token: user.token });
    expect(removed.status).toBe(200);

    const after = await get(BASE, { token: user.token });
    expect((await after.json()).memories).toHaveLength(0);
  });

  test('rejects an empty title with 400', async () => {
    const res = await post(BASE, { token: user.token, body: { title: '', content: 'x' } });
    expect(res.status).toBe(400);
  });

  test('returns 404 updating or deleting an unknown id', async () => {
    expect((await patch(`${BASE}/01HZZZZZZZZZZZZZZZZZZZZZZZ`, { token: user.token, body: { pinned: true } })).status).toBe(404);
    expect((await del(`${BASE}/01HZZZZZZZZZZZZZZZZZZZZZZZ`, { token: user.token })).status).toBe(404);
  });

  test('scopes memories to their owner', async () => {
    await post(BASE, { token: user.token, body: { title: 'Mine', content: 'x' } });
    const other = await seedUser();
    const res = await get(BASE, { token: other.token });
    expect((await res.json()).memories).toHaveLength(0);
  });
});
