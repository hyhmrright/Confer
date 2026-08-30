import { createHash } from 'node:crypto';
import { type EmbeddingProvider, providerModel } from './embedding.js';
import {
  deleteQdrantPoints,
  ensureQdrantCollection,
  providerMatchFilter,
  searchQdrantCollection,
  upsertQdrantPoints,
} from './qdrant-client.js';
import { VECTOR_SIZE } from './rag-config.js';

const COLLECTION = 'knowledge_chunks';

export function toUUID(id: string): string {
  const h = createHash('sha256').update(id).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

import type { TextLang } from './text-lang.js';

export interface KnowledgeChunk {
  chunk_id: string;
  kb_id: string;
  kb_name: string;
  doc_id: string;
  doc_name: string;
  user_id: string;
  text: string;
  chunk_index: number;
  vector: number[];
  provider: EmbeddingProvider;
  /** Dominant language of the source document, for the cross-lingual slots in `searchChunks`. */
  lang: TextLang;
}

export interface SearchResult {
  chunk_id: string;
  kb_id: string;
  kb_name: string;
  doc_id: string;
  doc_name: string;
  text: string;
  score: number;
}

export async function ensureCollection(): Promise<void> {
  await ensureQdrantCollection(COLLECTION, { vectorSize: VECTOR_SIZE, distance: 'Cosine' });
}

export async function upsertChunks(chunks: KnowledgeChunk[]): Promise<void> {
  if (chunks.length === 0) return;
  const points = chunks.map((c) => ({
    id: toUUID(c.chunk_id),
    vector: c.vector,
    payload: {
      kb_id: c.kb_id,
      kb_name: c.kb_name,
      doc_id: c.doc_id,
      doc_name: c.doc_name,
      user_id: c.user_id,
      text: c.text,
      chunk_index: c.chunk_index,
      embedding_provider: c.provider,
      embedding_model: providerModel(c.provider),
      lang: c.lang,
    },
  }));
  await upsertQdrantPoints(COLLECTION, points);
}

/**
 * Reserve result slots for documents in a language other than the query's.
 *
 * Cross-language similarity is systematically lower than same-language
 * similarity, so in a mixed-language knowledge base the documents in the
 * query's own language crowd out everything else — measured on the eval corpus,
 * Chinese questions whose answer lived in the one English document ranked 7th,
 * 15th and 19th, i.e. always just outside a top-5. Raising the depth to 20 does
 * fix recall (40% → 100%) but drags precision from 43% to 18%, and pays that on
 * every search including the single-language ones that never needed it.
 *
 * Giving the other languages their own small allowance costs one extra vector
 * query — no model call, no re-embedding — and leaves the main ranking alone.
 */
export interface CrossLingualSlots {
  /** The language the query is written in; documents in other languages get the slots. */
  queryLang: TextLang;
  /** How many extra results to reserve. */
  slots: number;
}

export async function searchChunks(
  vector: number[],
  userId: string,
  kbIds: string[] | undefined,
  topK = 5,
  provider?: EmbeddingProvider,
  scoreThreshold?: number,
  crossLingual?: CrossLingualSlots,
): Promise<SearchResult[]> {
  const mustFilters: unknown[] = [{ key: 'user_id', match: { value: userId } }];
  if (kbIds && kbIds.length > 0) {
    mustFilters.push({ key: 'kb_id', match: { any: kbIds } });
  }
  if (provider) mustFilters.push(providerMatchFilter(provider));

  const primary = await searchQdrantCollection(COLLECTION, vector, topK, {
    filter: { must: mustFilters },
    scoreThreshold,
  });

  const results = primary.map(toSearchResult);
  if (!crossLingual || crossLingual.slots <= 0) return results;

  // The same filters plus a language constraint — never a fresh filter list.
  // This query returns document text to a caller, so every tenant and scope
  // condition the primary search enforces has to hold here identically.
  const otherLangs = OTHER_LANGS[crossLingual.queryLang];
  const supplementary = await searchQdrantCollection(COLLECTION, vector, crossLingual.slots, {
    filter: { must: [...mustFilters, { key: 'lang', match: { any: otherLangs } }] },
    scoreThreshold,
  });

  // Points written before `lang` existed carry none, so they match no language
  // and simply do not appear here. That is the right degradation: their
  // language is unknown, and they already competed in the primary search.
  const seen = new Set(results.map((r) => r.chunk_id));
  for (const point of supplementary) {
    if (seen.has(point.id as string)) continue;
    results.push(toSearchResult(point));
  }
  return results;
}

const OTHER_LANGS: Record<TextLang, TextLang[]> = {
  zh: ['en', 'ja'],
  ja: ['en', 'zh'],
  en: ['zh', 'ja'],
};

function toSearchResult(r: {
  id: unknown;
  score: number;
  payload: Record<string, unknown>;
}): SearchResult {
  return {
    chunk_id: r.id as string,
    kb_id: r.payload.kb_id as string,
    kb_name: r.payload.kb_name as string,
    doc_id: r.payload.doc_id as string,
    doc_name: r.payload.doc_name as string,
    text: r.payload.text as string,
    score: r.score,
  };
}

export async function deleteByDocId(docId: string): Promise<void> {
  await deleteQdrantPoints(COLLECTION, { must: [{ key: 'doc_id', match: { value: docId } }] });
}

export async function deleteByKbId(kbId: string): Promise<void> {
  await deleteQdrantPoints(COLLECTION, { must: [{ key: 'kb_id', match: { value: kbId } }] });
}
