// Shared Qdrant HTTP client. Both the knowledge-base (qdrant.ts) and memory
// (memory-store.ts) collections talk to the same Qdrant instance through these
// helpers, so the URL resolution, timeouts, error shape, and per-collection
// request patterns stay in one place.

import { QDRANT_HEALTHCHECK_TIMEOUT_MS, QDRANT_REQUEST_TIMEOUT_MS } from './rag-config.js';

// Re-exported so existing importers keep resolving these from qdrant-client.
export { QDRANT_HEALTHCHECK_TIMEOUT_MS, QDRANT_REQUEST_TIMEOUT_MS };

export function qdrantUrl(path: string): string {
  const base = process.env.QDRANT_URL ?? 'http://localhost:6333';
  return `${base}${path}`;
}

export async function qdrantRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(qdrantUrl(path), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(QDRANT_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Qdrant ${method} ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export interface QdrantSearchHit {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

// Create the collection if it does not already exist. A 404 from the
// existence check means "missing", so we create it; any other non-OK status
// is a real error.
export async function ensureQdrantCollection(
  name: string,
  opts: { vectorSize: number; distance: 'Cosine' },
): Promise<void> {
  const res = await fetch(qdrantUrl(`/collections/${name}`), {
    signal: AbortSignal.timeout(QDRANT_HEALTHCHECK_TIMEOUT_MS),
  });
  if (res.status === 404) {
    await qdrantRequest('PUT', `/collections/${name}`, {
      vectors: { size: opts.vectorSize, distance: opts.distance },
    });
  } else if (!res.ok) {
    const text = await res.text();
    throw new Error(`Qdrant GET /collections/${name} failed (${res.status}): ${text}`);
  }
}

export async function upsertQdrantPoints(name: string, points: QdrantPoint[]): Promise<void> {
  if (points.length === 0) return;
  await qdrantRequest('PUT', `/collections/${name}/points?wait=true`, { points });
}

export async function searchQdrantCollection(
  name: string,
  vector: number[],
  limit: number,
  opts?: { filter?: unknown; scoreThreshold?: number },
): Promise<QdrantSearchHit[]> {
  const body: Record<string, unknown> = { vector, limit, with_payload: true };
  if (opts?.filter !== undefined) body.filter = opts.filter;
  if (opts?.scoreThreshold !== undefined && opts.scoreThreshold > 0) {
    body.score_threshold = opts.scoreThreshold;
  }
  const data = (await qdrantRequest('POST', `/collections/${name}/points/search`, body)) as {
    result: QdrantSearchHit[];
  };
  return data.result;
}

export async function deleteQdrantPoints(name: string, filter: unknown): Promise<void> {
  await qdrantRequest('POST', `/collections/${name}/points/delete`, { filter });
}
