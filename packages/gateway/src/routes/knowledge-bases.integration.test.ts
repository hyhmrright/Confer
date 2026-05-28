import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { VECTOR_SIZE } from '../lib/embedding.js';
import {
  type SeededUser,
  apiRequest,
  del,
  get,
  mockFetch,
  post,
  put,
  resetDb,
  seedUser,
} from '../test/helpers.js';

const BASE = '/api/v1/knowledge-bases';
let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

async function createKb(name = 'Docs'): Promise<string> {
  const res = await post(BASE, { token: user.token, body: { name } });
  expect(res.status).toBe(201);
  return (await res.json()).knowledge_base.id;
}

describe('knowledge base CRUD', () => {
  test('requires authentication', async () => {
    expect((await get(BASE)).status).toBe(401);
  });

  test('creates, lists and deletes a knowledge base', async () => {
    const id = await createKb('My KB');

    const listed = await get(BASE, { token: user.token });
    expect((await listed.json()).knowledge_bases).toHaveLength(1);

    expect((await del(`${BASE}/${id}`, { token: user.token })).status).toBe(200);
    expect((await del(`${BASE}/${id}`, { token: user.token })).status).toBe(404);
  });

  test('rejects an empty name with 400', async () => {
    expect((await post(BASE, { token: user.token, body: { name: '' } })).status).toBe(400);
  });

  test('404s listing documents of an unknown kb', async () => {
    expect((await get(`${BASE}/01HZZZZZZZZZZZZZZZZZZZZZZZ/documents`, { token: user.token })).status).toBe(404);
  });
});

describe('document ingestion (real MinIO + Qdrant, mocked embeddings)', () => {
  let restoreFetch: () => void;

  beforeEach(async () => {
    // Mock only the embedding HTTP API; Qdrant/MinIO calls pass through.
    restoreFetch = mockFetch((url, init) => {
      if (!url.includes('/embeddings')) return undefined;
      const texts = (JSON.parse(String(init?.body)) as { input: string[] }).input;
      return Response.json({
        data: texts.map((_, index) => ({ index, embedding: new Array(VECTOR_SIZE).fill(0.01) })),
      });
    });

    // A configured embedding key is required for ingestion to run.
    await put('/api/v1/agents/me/llm-keys', {
      token: user.token,
      body: { provider: 'openai', api_key: 'sk-test-embedding' },
    });
  });

  afterEach(() => restoreFetch());

  async function uploadText(kbId: string, name: string, content: string): Promise<Response> {
    const form = new FormData();
    form.append('file', new File([content], name, { type: 'text/plain' }));
    return apiRequest(`${BASE}/${kbId}/documents`, {
      method: 'POST',
      headers: { authorization: `Bearer ${user.token}`, 'x-forwarded-for': 'kb-upload' },
      body: form,
    });
  }

  test('uploads a document and runs it through the ingestion pipeline', async () => {
    const kbId = await createKb();

    const res = await uploadText(kbId, 'notes.txt', 'Confer is an A2A protocol platform for AI agents.');
    expect(res.status).toBe(201);
    const { document } = await res.json();
    expect(document.status).toBe('processing');

    // Ingestion runs asynchronously after the response; wait for a terminal state.
    let status = 'processing';
    let chunkCount = 0;
    for (let i = 0; i < 50 && status === 'processing'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const docs = await (await get(`${BASE}/${kbId}/documents`, { token: user.token })).json();
      status = docs.documents[0]?.status;
      chunkCount = docs.documents[0]?.chunk_count ?? 0;
    }

    expect(status).toBe('ready');
    expect(chunkCount).toBeGreaterThan(0);
  });
});
