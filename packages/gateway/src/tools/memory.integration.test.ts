import { beforeEach, describe, expect, test } from 'bun:test';
import type { LLMMessage, LLMProvider, LLMResponse } from '@confer/agent-runtime';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { agentMemories } from '../db/schema.js';
import { deleteMemory, ensureMemoryCollection } from '../lib/memory-store.js';
import { type SeededUser, mockFetch, resetDb, seedUser } from '../test/helpers.js';
import { extractAndStore, recallMemories } from './memory.js';

// Fake provider returning a fixed fact list for extraction.
function factProvider(facts: string[]): LLMProvider {
  return {
    name: 'fake',
    async chat(_m: LLMMessage[]): Promise<LLMResponse> {
      return {
        content: JSON.stringify(facts),
        finish_reason: 'stop',
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      };
    },
    async *stream() {},
  };
}

// Deterministic embedding stub. Any text mentioning a shared topic maps to one
// fixed hot index so related texts collide (cosine 1.0) and clear the recall
// threshold (0.3); unrelated text falls back to a char-sum hash so it stays
// (mostly) orthogonal and scores below threshold.
function embedVector(text: string): number[] {
  const v = new Array(1536).fill(0);
  if (text.includes('TypeScript')) {
    v[42] = 1;
    return v;
  }
  let h = 0;
  for (const ch of text) h = (h + ch.charCodeAt(0)) % 1536;
  v[h] = 1;
  return v;
}

// Stub the embedding API using the deterministic vector above.
function mockEmbedding(): () => void {
  return mockFetch((url, init) => {
    if (!url.includes('/embeddings')) return undefined;
    const body = JSON.parse(String(init?.body ?? '{}')) as { input: string[] };
    const data = body.input.map((text, i) => ({ embedding: embedVector(text), index: i }));
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

let user: SeededUser;
const KEY = 'sk-test';

beforeEach(async () => {
  await resetDb();
  await ensureMemoryCollection();
  user = await seedUser();
  await deleteMemory(user.id, undefined);
});

describe('memory orchestration', () => {
  test('extractAndStore writes facts to both Postgres and Qdrant', async () => {
    const restore = mockEmbedding();
    try {
      await extractAndStore({
        userId: user.id,
        provider: factProvider(['用户偏好 TypeScript', '用户在做 A2A 项目']),
        embeddingKey: KEY,
        embeddingProvider: 'openai',
        recentTurns: 'user: ...\nagent: ...',
      });
    } finally {
      restore();
    }

    const rows = await getDb()
      .select()
      .from(agentMemories)
      .where(eq(agentMemories.user_id, user.id));
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.source === 'auto')).toBe(true);

    const restore2 = mockEmbedding();
    try {
      // Query shares the 'TypeScript' topic → collides with the stored fact's
      // vector (cosine 1.0), clearing the 0.3 recall floor.
      const hits = await recallMemories('TypeScript 有什么技巧', user.id, KEY, 'openai');
      expect(hits).toContain('用户偏好 TypeScript');
    } finally {
      restore2();
    }
  });

  test('extractAndStore dedups: identical fact is skipped on second run', async () => {
    const run = async () => {
      const restore = mockEmbedding();
      try {
        await extractAndStore({
          userId: user.id,
          provider: factProvider(['用户偏好 TypeScript']),
          embeddingKey: KEY,
          embeddingProvider: 'openai',
          recentTurns: 'x',
        });
      } finally {
        restore();
      }
    };
    await run();
    await run();
    const rows = await getDb()
      .select()
      .from(agentMemories)
      .where(eq(agentMemories.user_id, user.id));
    expect(rows.length).toBe(1);
  });

  test('recallMemories returns empty string when nothing matches', async () => {
    const restore = mockEmbedding();
    try {
      const out = await recallMemories('完全不相关的查询', user.id, KEY, 'openai');
      expect(out).toBe('');
    } finally {
      restore();
    }
  });

  test('extractAndStore dedups: duplicate fact in same batch yields 1 row', async () => {
    const restore = mockEmbedding();
    try {
      await extractAndStore({
        userId: user.id,
        provider: factProvider(['用户偏好 X', '用户偏好 X']),
        embeddingKey: KEY,
        embeddingProvider: 'openai',
        recentTurns: 'x',
      });
    } finally {
      restore();
    }
    const rows = await getDb()
      .select()
      .from(agentMemories)
      .where(eq(agentMemories.user_id, user.id));
    expect(rows.length).toBe(1);
  });

  test('recallMemories scopes to the user', async () => {
    const other = await seedUser();
    await deleteMemory(other.id, undefined);
    const restore = mockEmbedding();
    try {
      await extractAndStore({
        userId: other.id,
        provider: factProvider(['别人的秘密']),
        embeddingKey: KEY,
        embeddingProvider: 'openai',
        recentTurns: 'x',
      });
      const out = await recallMemories('别人的秘密', user.id, KEY, 'openai');
      expect(out).toBe('');
    } finally {
      restore();
    }
  });
});
