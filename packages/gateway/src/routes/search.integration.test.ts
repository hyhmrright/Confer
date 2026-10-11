import { beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { messages } from '../db/schema.js';
import { get, post, resetDb, type SeededUser, seedUser } from '../test/helpers.js';

const SEARCH = '/api/v1/search/messages';
let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

async function threadWith(owner: SeededUser, ...contents: string[]): Promise<string> {
  const res = await post('/api/v1/conversations', { token: owner.token, body: { name: 'T' } });
  const id = (await res.json()).conversation.id as string;
  for (const content of contents) {
    await post(`/api/v1/conversations/${id}/messages`, { token: owner.token, body: { content } });
  }
  return id;
}

const contentsFor = async (q: string, token = user.token) =>
  (
    (await (await get(`${SEARCH}?q=${encodeURIComponent(q)}`, { token })).json()).results as Array<{
      content: string;
    }>
  ).map((r) => r.content);

describe('message search', () => {
  test('finds a substring inside Chinese text, newest first, with its thread', async () => {
    const id = await threadWith(user, '我们 Q3 的报价是多少？', '无关的一句', '报价单已经发过去了');

    const res = await get(`${SEARCH}?q=${encodeURIComponent('报价')}`, { token: user.token });
    const { results } = await res.json();
    expect(results.map((r: { content: string }) => r.content)).toEqual([
      '报价单已经发过去了',
      '我们 Q3 的报价是多少？',
    ]);
    expect(results[0].conversation_id).toBe(id);
    expect(results[0].conversation_name).toBe('T');
  });

  test('never returns another user’s messages', async () => {
    const other = await seedUser();
    await threadWith(other, 'secret pricing for acme');
    expect(await contentsFor('pricing')).toEqual([]);
    expect(await contentsFor('pricing', other.token)).toEqual(['secret pricing for acme']);
  });

  // An unescaped `%` or `_` is a wildcard, so "100%" would match "1000".
  test('treats LIKE wildcards in the query as literal text', async () => {
    await threadWith(user, 'discount is 100% off', 'we sold 1000 units', 'snake_case name');
    expect(await contentsFor('100%')).toEqual(['discount is 100% off']);
    expect(await contentsFor('_')).toEqual(['snake_case name']);
  });

  test('skips a message an admin has hidden', async () => {
    await threadWith(user, 'visible note', 'hidden note');
    await getDb()
      .update(messages)
      .set({ moderation_status: 'hidden' })
      .where(eq(messages.content, 'hidden note'));
    expect(await contentsFor('note')).toEqual(['visible note']);
  });

  test('rejects an empty or oversized query with 400', async () => {
    expect((await get(`${SEARCH}?q=%20`, { token: user.token })).status).toBe(400);
    expect((await get(`${SEARCH}?q=${'x'.repeat(201)}`, { token: user.token })).status).toBe(400);
  });

  test('requires authentication', async () => {
    expect((await get(`${SEARCH}?q=x`)).status).toBe(401);
  });

  test('caps the page at the requested limit', async () => {
    await threadWith(user, ...Array.from({ length: 5 }, (_, i) => `row ${i} ${newId()}`));
    const res = await get(`${SEARCH}?q=row&limit=2`, { token: user.token });
    expect((await res.json()).results).toHaveLength(2);
  });
});
