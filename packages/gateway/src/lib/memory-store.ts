import { type EmbeddingProvider, providerModel } from './embedding.js';
import { toUUID } from './qdrant.js';
import {
  deleteQdrantPoints,
  ensureQdrantCollection,
  providerMatchFilter,
  searchQdrantCollection,
  upsertQdrantPoints,
} from './qdrant-client.js';
import { VECTOR_SIZE } from './rag-config.js';

const COLLECTION = 'agent_memories_vec';

const MEMORY_SOURCES = ['manual', 'auto', 'a2a'] as const;

/**
 * Where a durable memory came from. Stored on the Postgres row and mirrored
 * into the Qdrant payload so recall can see it without a second query.
 *
 * `a2a` exists because an inbound peer question is distilled into the owner's
 * memory exactly like their own conversations are, and the two must not read
 * alike afterwards: a connected peer can otherwise write facts that resurface,
 * unattributed, inside the owner's private chats.
 */
export type MemorySource = (typeof MEMORY_SOURCES)[number];

// Both stores hold whatever was written into them — a Qdrant payload from an
// older build that wrote no source at all, or a free-form varchar row. Anything
// unrecognised reads as unknown rather than being asserted into the union.
export function asMemorySource(value: unknown): MemorySource | undefined {
  return MEMORY_SOURCES.find((source) => source === value);
}

export interface MemoryHit {
  memoryId: string;
  text: string;
  score: number;
  // Undefined for points written before memories carried their origin. Recall
  // treats an unknown origin the way it treated every memory back then.
  source?: MemorySource;
}

export interface UpsertMemoryInput {
  memoryId: string;
  userId: string;
  text: string;
  vector: number[];
  provider: EmbeddingProvider;
  source: MemorySource;
}

export async function ensureMemoryCollection(): Promise<void> {
  await ensureQdrantCollection(COLLECTION, { vectorSize: VECTOR_SIZE, distance: 'Cosine' });
}

export async function upsertMemory(input: UpsertMemoryInput): Promise<void> {
  await upsertQdrantPoints(COLLECTION, [
    {
      id: toUUID(input.memoryId),
      vector: input.vector,
      payload: {
        user_id: input.userId,
        memory_id: input.memoryId,
        text: input.text,
        source: input.source,
        embedding_provider: input.provider,
        embedding_model: providerModel(input.provider),
      },
    },
  ]);
}

export async function searchMemories(
  vector: number[],
  userId: string,
  topK = 5,
  minScore = 0.3,
  provider?: EmbeddingProvider,
): Promise<MemoryHit[]> {
  const mustFilters: unknown[] = [{ key: 'user_id', match: { value: userId } }];
  if (provider) mustFilters.push(providerMatchFilter(provider));

  const result = await searchQdrantCollection(COLLECTION, vector, topK, {
    filter: { must: mustFilters },
    scoreThreshold: minScore,
  });
  return result
    .filter((r) => typeof r.payload.memory_id === 'string' && typeof r.payload.text === 'string')
    .map((r) => ({
      memoryId: r.payload.memory_id as string,
      text: r.payload.text as string,
      score: r.score,
      source: asMemorySource(r.payload.source),
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
