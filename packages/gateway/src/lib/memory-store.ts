import { toUUID } from './qdrant.js';

const COLLECTION = 'agent_memories_vec';
// Embedding output dimension — must match VECTOR_SIZE in lib/embedding.ts; update both if switching providers
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
  } else if (!res.ok) {
    const text = await res.text();
    throw new Error(`Qdrant GET /collections/${COLLECTION} failed (${res.status}): ${text}`);
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
  const body: Record<string, unknown> = {
    vector,
    limit: topK,
    with_payload: true,
    filter: { must: [{ key: 'user_id', match: { value: userId } }] },
  };
  if (minScore > 0) body.score_threshold = minScore;
  const data = (await request('POST', `/collections/${COLLECTION}/points/search`, body)) as {
    result: Array<{ score: number; payload: Record<string, unknown> }>;
  };
  return data.result
    .filter((r) => typeof r.payload.memory_id === 'string' && typeof r.payload.text === 'string')
    .map((r) => ({
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
