import { createHash } from 'crypto';
import { VECTOR_SIZE } from './embedding.js';
import { QDRANT_HEALTHCHECK_TIMEOUT_MS, qdrantRequest, qdrantUrl } from './qdrant-client.js';

const COLLECTION = 'knowledge_chunks';

export function toUUID(id: string): string {
  const h = createHash('sha256').update(id).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

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
  const res = await fetch(qdrantUrl(`/collections/${COLLECTION}`), {
    signal: AbortSignal.timeout(QDRANT_HEALTHCHECK_TIMEOUT_MS),
  });
  if (res.status === 404) {
    await qdrantRequest('PUT', `/collections/${COLLECTION}`, {
      vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
    });
  }
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
    },
  }));
  await qdrantRequest('PUT', `/collections/${COLLECTION}/points?wait=true`, { points });
}

export async function searchChunks(
  vector: number[],
  userId: string,
  kbIds: string[] | undefined,
  topK = 5,
): Promise<SearchResult[]> {
  const mustFilters: unknown[] = [{ key: 'user_id', match: { value: userId } }];
  if (kbIds && kbIds.length > 0) {
    mustFilters.push({ key: 'kb_id', match: { any: kbIds } });
  }

  const body = {
    vector,
    limit: topK,
    with_payload: true,
    filter: { must: mustFilters },
  };

  const data = (await qdrantRequest('POST', `/collections/${COLLECTION}/points/search`, body)) as {
    result: Array<{ id: string; score: number; payload: Record<string, unknown> }>;
  };

  return data.result.map((r) => ({
    chunk_id: r.id as string,
    kb_id: r.payload.kb_id as string,
    kb_name: r.payload.kb_name as string,
    doc_id: r.payload.doc_id as string,
    doc_name: r.payload.doc_name as string,
    text: r.payload.text as string,
    score: r.score,
  }));
}

export async function deleteByDocId(docId: string): Promise<void> {
  await qdrantRequest('POST', `/collections/${COLLECTION}/points/delete`, {
    filter: { must: [{ key: 'doc_id', match: { value: docId } }] },
  });
}

export async function deleteByKbId(kbId: string): Promise<void> {
  await qdrantRequest('POST', `/collections/${COLLECTION}/points/delete`, {
    filter: { must: [{ key: 'kb_id', match: { value: kbId } }] },
  });
}
