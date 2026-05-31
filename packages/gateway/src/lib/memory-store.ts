import { VECTOR_SIZE } from './embedding.js';
import { QDRANT_HEALTHCHECK_TIMEOUT_MS, qdrantRequest, qdrantUrl } from './qdrant-client.js';
import { toUUID } from './qdrant.js';

const COLLECTION = 'agent_memories_vec';

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

export async function ensureMemoryCollection(): Promise<void> {
  const res = await fetch(qdrantUrl(`/collections/${COLLECTION}`), {
    signal: AbortSignal.timeout(QDRANT_HEALTHCHECK_TIMEOUT_MS),
  });
  if (res.status === 404) {
    await qdrantRequest('PUT', `/collections/${COLLECTION}`, {
      vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
    });
  } else if (!res.ok) {
    const text = await res.text();
    throw new Error(`Qdrant GET /collections/${COLLECTION} failed (${res.status}): ${text}`);
  }
}

export async function upsertMemory(input: UpsertMemoryInput): Promise<void> {
  await qdrantRequest('PUT', `/collections/${COLLECTION}/points?wait=true`, {
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
  const data = (await qdrantRequest('POST', `/collections/${COLLECTION}/points/search`, body)) as {
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
  await qdrantRequest('POST', `/collections/${COLLECTION}/points/delete`, { filter: { must } });
}
