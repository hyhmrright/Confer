import type { LLMProvider } from '@confer/agent-runtime';
import { newId } from '@confer/shared';
import { getDb } from '../db/connection.js';
import { agentMemories } from '../db/schema.js';
import { type EmbeddingProvider, embedTexts } from '../lib/embedding.js';
import { extractFacts } from '../lib/memory-extract.js';
import { type MemoryHit, searchMemories, upsertMemory } from '../lib/memory-store.js';

// Above this cosine similarity, a candidate fact is considered already known
// and is skipped (Mem0's NOOP semantics).
const DEDUP_THRESHOLD = 0.85;
const RECALL_TOP_K = 5;
const RECALL_MIN_SCORE = 0.3;

export interface ExtractAndStoreInput {
  userId: string;
  provider: LLMProvider;
  // Same model the turn itself ran on; omitting it would fall back to the
  // provider's default, which for Ollama is a model the owner has not pulled.
  model?: string;
  embeddingKey: string;
  embeddingProvider: EmbeddingProvider;
  recentTurns: string;
  // Which conversation these turns came from. `auto` is the owner's own chat;
  // `a2a` is an inbound peer question, whose facts are about the peer's inquiry
  // rather than about the owner and must stay separable from it afterwards.
  source: 'auto' | 'a2a';
}

// Extract durable facts from the latest turn and persist new ones to both
// Qdrant and Postgres. Best-effort: callers run this fire-and-forget.
export async function extractAndStore(input: ExtractAndStoreInput): Promise<void> {
  const facts = await extractFacts(input.provider, input.recentTurns, input.model);
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
    const similar = await searchMemories(
      vector,
      input.userId,
      1,
      DEDUP_THRESHOLD,
      input.embeddingProvider,
    );
    if (similar.length > 0) continue;

    const memoryId = newId();
    // PG row is written first; if the Qdrant upsert throws, the row persists (listable/manageable) but won't be recall-searchable until re-indexed. Acceptable for the fire-and-forget caller.
    await db.insert(agentMemories).values({
      id: memoryId,
      user_id: input.userId,
      title: text.slice(0, 80),
      content: text,
      source: input.source,
    });
    await upsertMemory({
      memoryId,
      userId: input.userId,
      text,
      vector,
      provider: input.embeddingProvider,
      source: input.source,
    });
  }
}

export interface MemoryRecall {
  /** System-prompt fragment, '' when nothing cleared the threshold. */
  fragment: string;
  /** The hits behind the fragment, so callers can report what recall did. */
  hits: MemoryHit[];
}

// Recall the most relevant memories for the current user message and format
// them as a system-prompt fragment.
//
// The hits come back alongside it because an empty fragment has three causes —
// nothing stored, nothing above RECALL_MIN_SCORE, or an indexing gap that left
// the rows unsearchable — and every one of them looked identical from the
// caller's side. That last case ran undetected for months once already.
export async function recallMemories(
  query: string,
  userId: string,
  embeddingKey: string,
  embeddingProvider: EmbeddingProvider,
): Promise<MemoryRecall> {
  const vectors = await embedTexts([query], embeddingKey, embeddingProvider);
  const vector = vectors[0];
  if (!vector) return { fragment: '', hits: [] };
  const hits = await searchMemories(
    vector,
    userId,
    RECALL_TOP_K,
    RECALL_MIN_SCORE,
    embeddingProvider,
  );
  if (hits.length === 0) return { fragment: '', hits };
  // A fact distilled from a peer's question describes that inquiry, not the
  // owner. Listed bare under "你已知道", "对方想了解我们的 Q3 数据" reads as
  // something the owner wants — so the origin is stated where the model sees it.
  const fragment = `\n关于该用户你已知道：\n${hits
    .map((h) => (h.source === 'a2a' ? `- （来自外部 Agent 的提问）${h.text}` : `- ${h.text}`))
    .join('\n')}`;
  return { fragment, hits };
}
