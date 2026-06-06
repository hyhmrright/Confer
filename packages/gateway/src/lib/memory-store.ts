import {
  deleteQdrantPoints,
  ensureQdrantCollection,
  searchQdrantCollection,
  upsertQdrantPoints,
} from './qdrant-client.js';
import { toUUID } from './qdrant.js';
import { VECTOR_SIZE } from './rag-config.js';

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
  await ensureQdrantCollection(COLLECTION, { vectorSize: VECTOR_SIZE, distance: 'Cosine' });
}

export async function upsertMemory(input: UpsertMemoryInput): Promise<void> {
  await upsertQdrantPoints(COLLECTION, [
    {
      id: toUUID(input.memoryId),
      vector: input.vector,
      payload: { user_id: input.userId, memory_id: input.memoryId, text: input.text },
    },
  ]);
}

export async function searchMemories(
  vector: number[],
  userId: string,
  topK = 5,
  minScore = 0.3,
): Promise<MemoryHit[]> {
  const result = await searchQdrantCollection(COLLECTION, vector, topK, {
    filter: { must: [{ key: 'user_id', match: { value: userId } }] },
    scoreThreshold: minScore,
  });
  return result
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
  await deleteQdrantPoints(COLLECTION, { must });
}
