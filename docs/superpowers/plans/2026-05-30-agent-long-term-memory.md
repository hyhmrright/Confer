# Agent 长期记忆 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Confer 的 agent 跨对话自动记住用户的持久事实（偏好/身份/目标/长期项目），并在后续对话中自动注入 system prompt。

**Architecture:** 采用 Mem0 的记忆配方（LLM 抽事实 → embed → 向量库去重 upsert → 语义召回），用 Confer 已跑通的零件原生实现：`createProvider`（per-user LLM）、`lib/embedding.ts`（多 provider embedding）、Qdrant（向量库）、`agent_memories` 表（Postgres）。写入每轮对话后异步 fire-and-forget；读取每次回复前同步注入；按 user_id 隔离。

**Tech Stack:** TypeScript + Bun + Hono；Drizzle ORM（PostgreSQL 16）；Qdrant REST；多 provider embedding/LLM。测试用 `bun:test` + 真 Postgres/Qdrant + `mockFetch` stub 外部 API。

参考设计：`docs/superpowers/specs/2026-05-30-agent-long-term-memory-design.md`

---

## File Structure

**Create:**
- `packages/gateway/src/lib/memory-store.ts` — Qdrant 记忆向量层（collection `agent_memories_vec`）：`ensureMemoryCollection` / `upsertMemory` / `searchMemories` / `deleteMemory`。
- `packages/gateway/src/lib/memory-extract.ts` — LLM 抽事实：`extractFacts(provider, recentTurns) → string[]`，含抽取 prompt 与 JSON 解析。
- `packages/gateway/src/tools/memory.ts` — 编排层：`extractAndStore(...)`（写入循环+去重）、`recallMemories(...)`（召回并返回 prompt 片段）。
- `packages/gateway/src/lib/memory-store.integration.test.ts` — memory-store 向量层测试。
- `packages/gateway/src/tools/memory.integration.test.ts` — 编排层测试。

**Modify:**
- `packages/gateway/src/db/schema.ts` — `agentMemories` 加 `source` 列。
- `packages/gateway/src/routes/stream.ts` — 接入 `recallMemories`（注入）+ `extractAndStore`（异步写入）。

**Generated:**
- `packages/gateway/drizzle/NNNN_*.sql` — 由 `bun run db:generate` 生成（勿手写）。

---

## Task 1: 给 `agent_memories` 加 `source` 列

**Files:**
- Modify: `packages/gateway/src/db/schema.ts:299-314`
- Generated: `packages/gateway/drizzle/NNNN_*.sql`（db:generate 产出）

- [ ] **Step 1: 修改 schema —— 加 `source` 列**

在 `agentMemories` 表定义里，`pinned` 行之后、`created_at` 行之前插入：

```typescript
    pinned: boolean('pinned').notNull().default(false),
    source: varchar('source', { length: 16 }).notNull().default('manual'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
```

确认 `varchar` 已在该文件顶部从 `drizzle-orm/pg-core` 导入（已用于其他表，无需新增导入）。

- [ ] **Step 2: 生成 migration**

Run: `bun run db:generate`
Expected: 在 `packages/gateway/drizzle/` 下生成一个新的 `NNNN_*.sql`，内容为 `ALTER TABLE "agent_memories" ADD COLUMN "source" varchar(16) DEFAULT 'manual' NOT NULL;`，且 `drizzle/meta/_journal.json` 追加了该条目。

> ⚠️ 绝不手写 SQL（CLAUDE.md pitfall：手写会导致 journal 不同步）。若 hook 阻止编辑 migration 文件，那是预期的——文件由 db:generate 生成即可，无需手动改。

- [ ] **Step 3: 应用 migration 到测试库**

Run: `bun run db:migrate`
Expected: 迁移成功应用，无报错。

- [ ] **Step 4: 验证 typecheck**

Run: `bun run typecheck`
Expected: 无错误。

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/db/schema.ts packages/gateway/drizzle/
git commit -m "feat(memory): add source column to agent_memories"
```

---

## Task 2: Qdrant 记忆向量层 `memory-store.ts`

**Files:**
- Create: `packages/gateway/src/lib/memory-store.ts`
- Test: `packages/gateway/src/lib/memory-store.integration.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/gateway/src/lib/memory-store.integration.test.ts`：

```typescript
import { beforeEach, describe, expect, test } from 'bun:test';
import {
  deleteMemory,
  ensureMemoryCollection,
  searchMemories,
  upsertMemory,
} from './memory-store.js';

// A deterministic unit vector helper: index `seed` is 1, rest 0.
function vec(seed: number): number[] {
  const v = new Array(1536).fill(0);
  v[seed % 1536] = 1;
  return v;
}

const userA = '01HMEMUSERAAAAAAAAAAAAAAAA';
const userB = '01HMEMUSERBBBBBBBBBBBBBBBB';

describe('memory-store', () => {
  beforeEach(async () => {
    await ensureMemoryCollection();
    // Clean any leftover points for these test users.
    await deleteMemory(userA, undefined);
    await deleteMemory(userB, undefined);
  });

  test('upserts a memory and finds it by similar vector', async () => {
    const id = '01HMEM00000000000000000001';
    await upsertMemory({ memoryId: id, userId: userA, text: '用户偏好 TypeScript', vector: vec(1) });
    const hits = await searchMemories(vec(1), userA, 5, 0.3);
    expect(hits.length).toBe(1);
    expect(hits[0].memoryId).toBe(id);
    expect(hits[0].text).toBe('用户偏好 TypeScript');
    expect(hits[0].score).toBeGreaterThan(0.9);
  });

  test('scopes search to user_id', async () => {
    await upsertMemory({ memoryId: '01HMEM00000000000000000002', userId: userA, text: 'A 的记忆', vector: vec(2) });
    await upsertMemory({ memoryId: '01HMEM00000000000000000003', userId: userB, text: 'B 的记忆', vector: vec(2) });
    const hitsB = await searchMemories(vec(2), userB, 5, 0.3);
    expect(hitsB.length).toBe(1);
    expect(hitsB[0].text).toBe('B 的记忆');
  });

  test('filters out hits below the score threshold', async () => {
    await upsertMemory({ memoryId: '01HMEM00000000000000000004', userId: userA, text: '不相关', vector: vec(10) });
    const hits = await searchMemories(vec(500), userA, 5, 0.3);
    expect(hits.length).toBe(0);
  });

  test('deletes a single memory by id', async () => {
    const id = '01HMEM00000000000000000005';
    await upsertMemory({ memoryId: id, userId: userA, text: '待删', vector: vec(7) });
    await deleteMemory(userA, id);
    const hits = await searchMemories(vec(7), userA, 5, 0.3);
    expect(hits.length).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/gateway && bun test src/lib/memory-store.integration.test.ts`
Expected: FAIL —— 模块 `./memory-store.js` 不存在 / 导出未定义。

- [ ] **Step 3: 实现 `memory-store.ts`**

创建 `packages/gateway/src/lib/memory-store.ts`：

```typescript
import { toUUID } from './qdrant.js';

const COLLECTION = 'agent_memories_vec';
const VECTOR_SIZE = 1536;

export interface MemoryHit {
  memoryId: string;
  text: string;
  score: number;
}

export interface UpsertMemoryInput {
  memoryId: string;
  userId: string;
  text: string;
  vector: number[];
}

function qdrantUrl(path: string): string {
  const base = process.env.QDRANT_URL ?? 'http://localhost:6333';
  return `${base}${path}`;
}

async function request(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(qdrantUrl(path), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Qdrant ${method} ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function ensureMemoryCollection(): Promise<void> {
  const res = await fetch(qdrantUrl(`/collections/${COLLECTION}`), {
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) {
    await request('PUT', `/collections/${COLLECTION}`, {
      vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
    });
  }
}

export async function upsertMemory(input: UpsertMemoryInput): Promise<void> {
  await request('PUT', `/collections/${COLLECTION}/points?wait=true`, {
    points: [
      {
        id: toUUID(input.memoryId),
        vector: input.vector,
        payload: { user_id: input.userId, memory_id: input.memoryId, text: input.text },
      },
    ],
  });
}

export async function searchMemories(
  vector: number[],
  userId: string,
  topK = 5,
  minScore = 0.3,
): Promise<MemoryHit[]> {
  const body = {
    vector,
    limit: topK,
    with_payload: true,
    score_threshold: minScore,
    filter: { must: [{ key: 'user_id', match: { value: userId } }] },
  };
  const data = (await request('POST', `/collections/${COLLECTION}/points/search`, body)) as {
    result: Array<{ score: number; payload: Record<string, unknown> }>;
  };
  return data.result.map((r) => ({
    memoryId: r.payload.memory_id as string,
    text: r.payload.text as string,
    score: r.score,
  }));
}

// Delete one memory by id (memoryId required), or all of a user's memories
// when memoryId is undefined.
export async function deleteMemory(userId: string, memoryId: string | undefined): Promise<void> {
  const must: unknown[] = [{ key: 'user_id', match: { value: userId } }];
  if (memoryId !== undefined) {
    must.push({ key: 'memory_id', match: { value: memoryId } });
  }
  await request('POST', `/collections/${COLLECTION}/points/delete`, { filter: { must } });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/gateway && bun test src/lib/memory-store.integration.test.ts`
Expected: PASS —— 4 个测试全过。

- [ ] **Step 5: lint + typecheck**

Run: `bun run typecheck && bun run lint`
Expected: 无错误（hook 也会自动跑 lint:fix + typecheck）。

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/lib/memory-store.ts packages/gateway/src/lib/memory-store.integration.test.ts
git commit -m "feat(memory): add Qdrant memory vector store"
```

---

## Task 3: LLM 抽事实 `memory-extract.ts`

**Files:**
- Create: `packages/gateway/src/lib/memory-extract.ts`
- Test: `packages/gateway/src/lib/memory-extract.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/gateway/src/lib/memory-extract.test.ts`（纯单元测试，用假的 provider，不需要 infra）：

```typescript
import { describe, expect, test } from 'bun:test';
import type { LLMMessage, LLMProvider, LLMResponse } from '@confer/agent-runtime';
import { extractFacts } from './memory-extract.js';

function fakeProvider(content: string): LLMProvider {
  return {
    name: 'fake',
    async chat(_messages: LLMMessage[]): Promise<LLMResponse> {
      return { content, finish_reason: 'stop', usage: { prompt_tokens: 0, completion_tokens: 0 } };
    },
    async *stream() {
      // not used in extraction
    },
  };
}

describe('extractFacts', () => {
  test('parses a JSON array of facts', async () => {
    const provider = fakeProvider('["用户在做 A2A 项目", "用户偏好 TypeScript"]');
    const facts = await extractFacts(provider, 'user: 我在做 A2A\nagent: 好的');
    expect(facts).toEqual(['用户在做 A2A 项目', '用户偏好 TypeScript']);
  });

  test('strips markdown code fences before parsing', async () => {
    const provider = fakeProvider('```json\n["事实一"]\n```');
    const facts = await extractFacts(provider, 'whatever');
    expect(facts).toEqual(['事实一']);
  });

  test('returns empty array when model outputs empty array', async () => {
    const provider = fakeProvider('[]');
    expect(await extractFacts(provider, 'hi')).toEqual([]);
  });

  test('returns empty array on unparseable output instead of throwing', async () => {
    const provider = fakeProvider('抱歉我无法处理');
    expect(await extractFacts(provider, 'hi')).toEqual([]);
  });

  test('drops non-string and empty entries', async () => {
    const provider = fakeProvider('["ok", "", 123, "  "]');
    expect(await extractFacts(provider, 'hi')).toEqual(['ok']);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/gateway && bun test src/lib/memory-extract.test.ts`
Expected: FAIL —— 模块/导出不存在。

- [ ] **Step 3: 实现 `memory-extract.ts`**

创建 `packages/gateway/src/lib/memory-extract.ts`：

```typescript
import type { LLMMessage, LLMProvider } from '@confer/agent-runtime';

const EXTRACTION_SYSTEM_PROMPT = `你是一个记忆抽取器。从给定的对话片段中，抽取关于「用户」的持久、稳定的事实：偏好、身份、长期目标、正在进行的项目、重要约束等。
规则：
- 只抽取值得长期记住的事实，忽略一次性的闲聊、寒暄、临时问答。
- 每条事实是一个独立、自包含的简短陈述句（中文）。
- 不要抽取关于 AI 助手自己的内容。
- 严格只输出一个 JSON 字符串数组，不要任何解释或 markdown 代码块。
- 如果没有值得记住的事实，输出 []。`;

function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

// Extract durable facts about the user from a conversation snippet. Returns []
// on any parse failure — extraction is a best-effort enhancement, never fatal.
export async function extractFacts(provider: LLMProvider, recentTurns: string): Promise<string[]> {
  const messages: LLMMessage[] = [
    { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
    { role: 'user', content: recentTurns },
  ];
  const res = await provider.chat(messages, { temperature: 0 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(res.content));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/gateway && bun test src/lib/memory-extract.test.ts`
Expected: PASS —— 5 个测试全过。

- [ ] **Step 5: lint + typecheck**

Run: `bun run typecheck && bun run lint`
Expected: 无错误。

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/lib/memory-extract.ts packages/gateway/src/lib/memory-extract.test.ts
git commit -m "feat(memory): add LLM fact extraction"
```

---

## Task 4: 编排层 `tools/memory.ts`

**Files:**
- Create: `packages/gateway/src/tools/memory.ts`
- Test: `packages/gateway/src/tools/memory.integration.test.ts`

依赖：Task 2（memory-store）、Task 3（memory-extract）、Task 1（source 列）。

- [ ] **Step 1: 写失败测试**

创建 `packages/gateway/src/tools/memory.integration.test.ts`。这是 integration 测试：真 Postgres + 真 Qdrant，但 LLM 抽事实用注入的假 provider、embedding 用 `mockFetch` stub。

```typescript
import { beforeEach, describe, expect, test } from 'bun:test';
import type { LLMMessage, LLMProvider, LLMResponse } from '@confer/agent-runtime';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { agentMemories } from '../db/schema.js';
import { ensureMemoryCollection, deleteMemory } from '../lib/memory-store.js';
import { mockFetch, resetDb, seedUser, type SeededUser } from '../test/helpers.js';
import { extractAndStore, recallMemories } from './memory.js';

// Fake provider returning a fixed fact list for extraction.
function factProvider(facts: string[]): LLMProvider {
  return {
    name: 'fake',
    async chat(_m: LLMMessage[]): Promise<LLMResponse> {
      return { content: JSON.stringify(facts), finish_reason: 'stop', usage: { prompt_tokens: 0, completion_tokens: 0 } };
    },
    async *stream() {},
  };
}

// Stub the embedding API: returns a unit vector whose hot index is derived from
// the input text so identical text → identical vector (similarity 1.0), and
// different text → orthogonal vector (similarity 0).
function mockEmbedding(): () => void {
  return mockFetch((url, init) => {
    if (!url.includes('/embeddings')) return undefined;
    const body = JSON.parse(String(init?.body ?? '{}')) as { input: string[] };
    const data = body.input.map((text, i) => {
      const v = new Array(1536).fill(0);
      let h = 0;
      for (const ch of text) h = (h + ch.charCodeAt(0)) % 1536;
      v[h] = 1;
      return { embedding: v, index: i };
    });
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
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

    const rows = await getDb().select().from(agentMemories).where(eq(agentMemories.user_id, user.id));
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.source === 'auto')).toBe(true);

    const restore2 = mockEmbedding();
    try {
      const hits = await recallMemories('TypeScript 怎么写', user.id, KEY, 'openai');
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
    const rows = await getDb().select().from(agentMemories).where(eq(agentMemories.user_id, user.id));
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/gateway && bun test src/tools/memory.integration.test.ts`
Expected: FAIL —— `./memory.js` 不存在。

- [ ] **Step 3: 实现 `tools/memory.ts`**

创建 `packages/gateway/src/tools/memory.ts`：

```typescript
import type { LLMProvider } from '@confer/agent-runtime';
import { newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { agentMemories } from '../db/schema.js';
import { type EmbeddingProvider, embedTexts } from '../lib/embedding.js';
import { extractFacts } from '../lib/memory-extract.js';
import { searchMemories, upsertMemory } from '../lib/memory-store.js';

// Above this cosine similarity, a candidate fact is considered already known
// and is skipped (Mem0's NOOP semantics).
const DEDUP_THRESHOLD = 0.85;
const RECALL_TOP_K = 5;
const RECALL_MIN_SCORE = 0.3;

export interface ExtractAndStoreInput {
  userId: string;
  provider: LLMProvider;
  embeddingKey: string;
  embeddingProvider: EmbeddingProvider;
  recentTurns: string;
}

// Extract durable facts from the latest turn and persist new ones to both
// Qdrant and Postgres. Best-effort: callers run this fire-and-forget.
export async function extractAndStore(input: ExtractAndStoreInput): Promise<void> {
  const facts = await extractFacts(input.provider, input.recentTurns);
  if (facts.length === 0) return;

  const vectors = await embedTexts(facts, input.embeddingKey, input.embeddingProvider);
  const db = getDb();

  for (let i = 0; i < facts.length; i++) {
    const text = facts[i];
    const vector = vectors[i];
    if (!vector) continue;

    // Dedup: skip if a near-identical memory already exists.
    const similar = await searchMemories(vector, input.userId, 1, DEDUP_THRESHOLD);
    if (similar.length > 0) continue;

    const memoryId = newId();
    await db.insert(agentMemories).values({
      id: memoryId,
      user_id: input.userId,
      title: text.slice(0, 80),
      content: text,
      source: 'auto',
    });
    await upsertMemory({ memoryId, userId: input.userId, text, vector });
  }
}

// Recall the most relevant memories for the current user message and format
// them as a system-prompt fragment. Returns '' when nothing relevant is found.
export async function recallMemories(
  query: string,
  userId: string,
  embeddingKey: string,
  embeddingProvider: EmbeddingProvider,
): Promise<string> {
  const vectors = await embedTexts([query], embeddingKey, embeddingProvider);
  const vector = vectors[0];
  if (!vector) return '';
  const hits = await searchMemories(vector, userId, RECALL_TOP_K, RECALL_MIN_SCORE);
  if (hits.length === 0) return '';
  return `\n关于该用户你已知道：\n${hits.map((h) => `- ${h.text}`).join('\n')}`;
}

// Re-export for callers that need the column value, keeps schema usage local.
export { agentMemories };
export { eq };
```

> 注：`extractAndStore` 内的 `recallMemories` 用作 dedup 的 `searchMemories(vector, userId, 1, DEDUP_THRESHOLD)` —— 直接复用 `memory-store` 的 `score_threshold`，命中即说明已知。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/gateway && bun test src/tools/memory.integration.test.ts`
Expected: PASS —— 4 个测试全过。

- [ ] **Step 5: lint + typecheck**

Run: `bun run typecheck && bun run lint`
Expected: 无错误。

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/tools/memory.ts packages/gateway/src/tools/memory.integration.test.ts
git commit -m "feat(memory): add extract-and-store and recall orchestration"
```

---

## Task 5: 接入 stream.ts —— 注入 + 异步写入

**Files:**
- Modify: `packages/gateway/src/routes/stream.ts`

依赖：Task 4。

- [ ] **Step 1: 加 import**

在 `stream.ts` 顶部 import 区，`tavily` import 之后加：

```typescript
import { extractAndStore, recallMemories } from '../tools/memory.js';
import { ensureMemoryCollection } from '../lib/memory-store.js';
```

- [ ] **Step 2: 召回并注入 system prompt**

在 `stream.ts` 现有的 embedding provider 解析块之后（`embeddingProvider` 与 `embeddingKey` 已确定，约第 125 行后）、在 `buildSystemPrompt` 调用之前，插入召回逻辑。然后把召回片段拼到 system prompt。

找到这段（约 146-151 行）：

```typescript
      const effectiveSystemPrompt = buildSystemPrompt(systemPrompt, userKbs.length > 0);
      let agentMessages: LLMMessage[] = [
        { role: 'system', content: effectiveSystemPrompt },
        ...history,
        { role: 'user', content: msg.content ?? '' },
      ];
```

替换为：

```typescript
      let memoryFragment = '';
      if (embeddingKey) {
        try {
          await ensureMemoryCollection();
          memoryFragment = await recallMemories(
            msg.content ?? '',
            user.sub,
            embeddingKey,
            embeddingProvider,
          );
        } catch (err) {
          console.error(`Memory recall failed for user ${user.sub}:`, err);
        }
      }

      const effectiveSystemPrompt =
        buildSystemPrompt(systemPrompt, userKbs.length > 0) + memoryFragment;
      let agentMessages: LLMMessage[] = [
        { role: 'system', content: effectiveSystemPrompt },
        ...history,
        { role: 'user', content: msg.content ?? '' },
      ];
```

- [ ] **Step 3: 异步抽取写入（在 done 之后 fire-and-forget）**

找到 stream 末尾发送 `done` 事件的块（约 258-261 行）：

```typescript
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ message_id: replyId }),
      });
```

在它**之后**（仍在 try 内、catch 之前）插入 fire-and-forget 写入。注意：抽取用与对话相同的 `provider`、`embeddingKey`、`embeddingProvider`，仅当 `embeddingKey` 存在时才触发：

```typescript
      // Fire-and-forget: extract durable facts from this turn into long-term
      // memory. Never block or fail the response on memory errors.
      if (embeddingKey && fullContent) {
        const recentTurns = `用户：${msg.content ?? ''}\n助手：${fullContent}`;
        void extractAndStore({
          userId: user.sub,
          provider,
          embeddingKey,
          embeddingProvider,
          recentTurns,
        }).catch((err) => {
          console.error(`Memory extraction failed for user ${user.sub}:`, err);
        });
      }
```

- [ ] **Step 4: typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: 无错误。

- [ ] **Step 5: 端到端 integration 测试**

创建 `packages/gateway/src/routes/stream-memory.integration.test.ts`，验证「第一轮存的记忆在第二轮被注入」。该测试 mock LLM stream（OpenAI 兼容）+ embedding，断言第二轮请求的 system prompt 中包含第一轮抽出的事实。

```typescript
import { beforeEach, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { agents, conversations, conversationParticipants, messages, users } from '../db/schema.js';
import { newId } from '@confer/shared';
import { encrypt } from '@confer/shared';
import { getEnv } from '../env.js';
import { ensureMemoryCollection, deleteMemory } from '../lib/memory-store.js';
import { apiRequest, headers, mockFetch, resetDb, seedUser, type SeededUser } from '../test/helpers.js';

// NOTE: This test asserts the system prompt sent to the LLM on the SECOND turn
// contains the fact extracted from the FIRST turn. We capture every chat
// request body via the embedding+LLM mock.

let user: SeededUser;
let capturedSystemPrompts: string[] = [];

function mockOpenAIAndEmbedding(assistantReply: string, facts: string[]): () => void {
  return mockFetch((url, init) => {
    // Embedding endpoint → deterministic text-derived unit vector.
    if (url.includes('/embeddings')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { input: string[] };
      const data = body.input.map((text, i) => {
        const v = new Array(1536).fill(0);
        let h = 0;
        for (const ch of text) h = (h + ch.charCodeAt(0)) % 1536;
        v[h] = 1;
        return { embedding: v, index: i };
      });
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    // OpenAI chat completions (used by both streaming reply and fact extraction).
    if (url.includes('/chat/completions')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        stream?: boolean;
        messages: Array<{ role: string; content: string }>;
      };
      const sys = body.messages.find((m) => m.role === 'system')?.content ?? '';
      capturedSystemPrompts.push(sys);
      if (body.stream) {
        // Minimal SSE stream with a single content delta then [DONE].
        const chunks = [
          `data: ${JSON.stringify({ choices: [{ delta: { content: assistantReply } }] })}\n\n`,
          'data: [DONE]\n\n',
        ];
        return new Response(chunks.join(''), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      // Non-streaming → used by extractFacts: return JSON array of facts.
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(facts) }, finish_reason: 'stop' }], usage: {} }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return undefined;
  });
}

async function setupUserWithAgent(): Promise<{ u: SeededUser; convId: string }> {
  const u = await seedUser();
  const env = getEnv();
  // Store an encrypted OpenAI key so provider + embedding resolve.
  const enc = await encrypt('sk-test', env.ENCRYPTION_KEY);
  await getDb().update(users).set({ llm_keys_json: { openai: enc } }).where(eq(users.id, u.id));
  const agentId = newId();
  await getDb().insert(agents).values({
    id: agentId,
    user_id: u.id,
    did: u.did,
    model_config_json: { provider: 'openai', system_prompt: '你是助手。' },
  });
  const convId = newId();
  await getDb().insert(conversations).values({ id: convId, created_by: u.id });
  await getDb().insert(conversationParticipants).values({
    conversation_id: convId,
    user_id: u.id,
  });
  return { u, convId };
}

async function postUserMessage(convId: string, userId: string, text: string): Promise<string> {
  const id = newId();
  await getDb().insert(messages).values({
    id,
    conversation_id: convId,
    sender_type: 'user',
    sender_id: userId,
    content_type: 'text',
    content: text,
  });
  return id;
}

beforeEach(async () => {
  await resetDb();
  await ensureMemoryCollection();
  capturedSystemPrompts = [];
});

describe('stream long-term memory', () => {
  test('a fact stored on turn 1 is injected into the system prompt on turn 2', async () => {
    const { u, convId } = await setupUserWithAgent();
    await deleteMemory(u.id, undefined);

    // Turn 1: user states a preference; mock extracts it as a fact.
    const restore1 = mockOpenAIAndEmbedding('好的', ['用户偏好 TypeScript']);
    try {
      const msg1 = await postUserMessage(convId, u.id, '我喜欢用 TypeScript');
      const res1 = await apiRequest(`/api/v1/stream/${convId}/${msg1}`, {
        method: 'GET',
        headers: headers({ token: u.token }),
      });
      // Drain the SSE stream to completion so fire-and-forget extraction runs.
      await res1.text();
    } finally {
      restore1();
    }

    // Give the fire-and-forget extraction a tick to settle.
    await new Promise((r) => setTimeout(r, 200));

    // Turn 2: a related query should recall the stored fact into system prompt.
    capturedSystemPrompts = [];
    const restore2 = mockOpenAIAndEmbedding('明白', []);
    try {
      const msg2 = await postUserMessage(convId, u.id, 'TypeScript 有什么技巧');
      const res2 = await apiRequest(`/api/v1/stream/${convId}/${msg2}`, {
        method: 'GET',
        headers: headers({ token: u.token }),
      });
      await res2.text();
    } finally {
      restore2();
    }

    // The streaming chat call on turn 2 must have seen the recalled fact.
    const streamingSysPrompt = capturedSystemPrompts.find((s) => s.includes('TypeScript'));
    expect(streamingSysPrompt).toBeDefined();
    expect(streamingSysPrompt).toContain('用户偏好 TypeScript');
  });
});
```

> ⚠️ 实现 Task 5 时，若 `conversations` / `agents` 表的真实列名或必填字段与上面 seed 代码不符（例如 `agents` 还有 `name` 非空列），按 `schema.ts` 实际定义补齐 seed 字段——以 schema 为准。运行测试前先核对。

- [ ] **Step 6: 运行端到端测试**

Run: `cd packages/gateway && bun test src/routes/stream-memory.integration.test.ts`
Expected: PASS。若因 seed 字段不全失败，按上面提示对照 `schema.ts` 补齐后重跑。

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/routes/stream.ts packages/gateway/src/routes/stream-memory.integration.test.ts
git commit -m "feat(memory): inject recalled memories and extract facts in stream"
```

---

## Task 6: 全量验证 + 部署

**Files:** 无新增。

- [ ] **Step 1: 跑全部 gateway 测试**

Run: `bun run test`
Expected: 所有包测试通过，包括新增的 memory 测试，0 失败。

- [ ] **Step 2: typecheck + lint 全量**

Run: `bun run typecheck && bun run lint`
Expected: 无错误。

- [ ] **Step 3: 构建 + 部署 gateway**

仅 gateway 改动，按 CLAUDE.md 部署表：

Run: `bun run build && docker compose -f docker-compose.prod.yml build gateway && docker compose -f docker-compose.prod.yml up -d gateway`
Expected: 构建成功，容器重启。

- [ ] **Step 4: 健康检查**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost/health`
Expected: `200`。

- [ ] **Step 5: 最终 commit（若有未提交的部署相关改动）+ push**

```bash
git push origin dev
```

---

## 范围边界提醒（不在本计划内）

- A2A 路径接入记忆（`a2a.ts:328` 的 `conversationHistory: []`）—— `recallMemories` 已设计为可独立调用，后续单独接。
- 记忆的更新/失效语义（Mem0 的 UPDATE/DELETE）—— 当前只做 ADD + NOOP 去重。
- 按 agent 维度隔离、记忆条数上限/淘汰 —— 监控后再定。

---

## Self-Review notes

- **Spec 覆盖**：双写存储（Task 1+2+4）、抽事实（Task 3）、去重 0.85（Task 4）、召回 top-K=5/score≥0.3 注入（Task 4+5）、异步 fire-and-forget + 错误静默（Task 5）、无 key 降级（Task 4/5 的 `if (embeddingKey)` 守卫）、按 user_id 隔离（Task 2/4 测试）、5 项测试策略（Task 2/3/4/5 覆盖）、migration 走 db:generate（Task 1）、Qdrant 用 toUUID（Task 2）、不发 key 给 client（仅服务端用）—— 全部有对应任务。
- **类型一致性**：`searchMemories(vector, userId, topK, minScore)`、`upsertMemory({memoryId,userId,text,vector})`、`deleteMemory(userId, memoryId?)`、`extractFacts(provider, recentTurns)`、`extractAndStore(input)`、`recallMemories(query, userId, key, provider)` —— 在定义任务与调用任务间签名一致。
- **无占位符**：所有步骤含完整代码与确切命令。
