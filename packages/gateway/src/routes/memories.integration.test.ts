import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { getDb } from '../db/connection.js';
import { agentMemories } from '../db/schema.js';
import { VECTOR_SIZE } from '../lib/embedding.js';
import { ensureMemoryCollection, searchMemories, upsertMemory } from '../lib/memory-store.js';
import {
  del,
  get,
  mockFetch,
  patch,
  post,
  put,
  resetDb,
  type SeededUser,
  seedUser,
} from '../test/helpers.js';

const BASE = '/api/v1/memories';
let user: SeededUser;

// A vector whose direction encodes `text`, so two different memories are not
// each other's nearest neighbour and a stale index is visible as a miss.
function vectorFor(text: string): number[] {
  const v = new Array(VECTOR_SIZE).fill(0);
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) % VECTOR_SIZE;
  v[hash] = 1;
  return v;
}

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

describe('memories', () => {
  test('requires authentication', async () => {
    expect((await get(BASE)).status).toBe(401);
  });

  test('refuses to store a memory it cannot index', async () => {
    // No embedding key configured. Storing the row anyway is what produced
    // memories that were listed in the UI and invisible to recall forever.
    const res = await post(BASE, { token: user.token, body: { title: 'N', content: 'Body' } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('embedding_unavailable');

    const rows = await getDb().select().from(agentMemories);
    expect(rows).toHaveLength(0);
  });

  test('rejects an empty title with 400', async () => {
    const res = await post(BASE, { token: user.token, body: { title: '', content: 'x' } });
    expect(res.status).toBe(400);
  });

  test('returns 404 updating or deleting an unknown id', async () => {
    expect(
      (
        await patch(`${BASE}/01HZZZZZZZZZZZZZZZZZZZZZZZ`, {
          token: user.token,
          body: { pinned: true },
        })
      ).status,
    ).toBe(404);
    expect((await del(`${BASE}/01HZZZZZZZZZZZZZZZZZZZZZZZ`, { token: user.token })).status).toBe(
      404,
    );
  });

  test('deleting a memory also removes its Qdrant vector', async () => {
    await ensureMemoryCollection();
    // Seed a row + matching vector, as the auto-extraction path would.
    const id = newId();
    const vector = vectorFor('Fact');
    await getDb()
      .insert(agentMemories)
      .values({ id, user_id: user.id, title: 'Fact', content: 'Fact', source: 'auto' });
    await upsertMemory({
      memoryId: id,
      userId: user.id,
      text: 'Fact',
      vector,
      provider: 'openai',
      source: 'auto',
    });
    expect(await searchMemories(vector, user.id, 5, 0.3)).toHaveLength(1);

    const removed = await del(`${BASE}/${id}`, { token: user.token });
    expect(removed.status).toBe(200);

    expect(await searchMemories(vector, user.id, 5, 0.3)).toHaveLength(0);
  });
});

describe('memories (real Qdrant, mocked embeddings)', () => {
  let restoreFetch: () => void;

  beforeEach(async () => {
    await ensureMemoryCollection();
    // Mock only the embedding HTTP API; Qdrant calls pass through.
    restoreFetch = mockFetch((url, init) => {
      if (!url.includes('/embeddings')) return undefined;
      const texts = (JSON.parse(String(init?.body)) as { input: string[] }).input;
      return Response.json({
        data: texts.map((text, index) => ({ index, embedding: vectorFor(text) })),
      });
    });
    await put('/api/v1/agents/me/llm-keys', {
      token: user.token,
      body: { provider: 'openai', api_key: 'sk-test-embedding' },
    });
  });

  afterEach(() => restoreFetch());

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

  test('scopes memories to their owner', async () => {
    await post(BASE, { token: user.token, body: { title: 'Mine', content: 'x' } });
    const other = await seedUser();
    const res = await get(BASE, { token: other.token });
    expect((await res.json()).memories).toHaveLength(0);
  });

  test('a memory written through the API is recallable', async () => {
    // The whole point of the feature: recall reads Qdrant, never this table, so
    // a row without a vector is a memory the agent can never see. This route
    // wrote the row and nothing else.
    const created = await post(BASE, {
      token: user.token,
      body: { title: 'Supplier', content: 'Hengxin ships in three days' },
    });
    expect(created.status).toBe(201);

    const hits = await searchMemories(vectorFor('Hengxin ships in three days'), user.id, 5, 0.3);
    expect(hits.map((h) => h.text)).toEqual(['Hengxin ships in three days']);
  });

  test('editing the text re-indexes it, so recall stops answering from the old wording', async () => {
    const created = await post(BASE, {
      token: user.token,
      body: { title: 'Supplier', content: 'Hengxin ships in three days' },
    });
    const { memory } = await created.json();

    const updated = await patch(`${BASE}/${memory.id}`, {
      token: user.token,
      body: { content: 'Hengxin ships in three weeks' },
    });
    expect(updated.status).toBe(200);

    expect(await searchMemories(vectorFor('Hengxin ships in three days'), user.id, 5, 0.9)).toEqual(
      [],
    );
    const hits = await searchMemories(vectorFor('Hengxin ships in three weeks'), user.id, 5, 0.3);
    expect(hits.map((h) => h.text)).toEqual(['Hengxin ships in three weeks']);
  });

  test('an edit that touches no text leaves the index alone', async () => {
    const created = await post(BASE, {
      token: user.token,
      body: { title: 'Supplier', content: 'Hengxin ships in three days' },
    });
    const { memory } = await created.json();

    await patch(`${BASE}/${memory.id}`, { token: user.token, body: { pinned: true } });

    const hits = await searchMemories(vectorFor('Hengxin ships in three days'), user.id, 5, 0.3);
    expect(hits.map((h) => h.text)).toEqual(['Hengxin ships in three days']);
  });
});
