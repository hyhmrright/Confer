import type { LLMProvider } from '@confer/agent-runtime';
import { newId } from '@confer/shared';
import { getDb } from '../db/connection.js';
import { agentMemories } from '../db/schema.js';
import { type EmbeddingProvider, embedTexts } from '../lib/embedding.js';
import { extractFacts } from '../lib/memory-extract.js';
import { searchMemories, upsertMemory } from '../lib/memory-store.js';

// Above this cosine similarity, a candidate fact is considered already known
// and is skipped (Mem0's NOOP semantics).
const DEDUP_THRESHOLD = 0.85;
const RECALL_TOP_K = 5;
const RECALL_MIN_SCORE = 0;

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
  const seen = new Set<string>();

  for (let i = 0; i < facts.length; i++) {
    const text = facts[i];
    const vector = vectors[i];
    if (!text || !vector) continue;

    // Within-batch dedup: skip duplicate fact texts before hitting the DB/Qdrant.
    if (seen.has(text)) continue;
    seen.add(text);

    // Dedup: skip if a near-identical memory already exists.
    const similar = await searchMemories(vector, input.userId, 1, DEDUP_THRESHOLD);
    if (similar.length > 0) continue;

    const memoryId = newId();
    // PG row is written first; if the Qdrant upsert throws, the row persists (listable/manageable) but won't be recall-searchable until re-indexed. Acceptable for the fire-and-forget caller.
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
