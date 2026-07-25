// Single source of truth for RAG pipeline constants (vector dimensions, batch
// sizes, network timeouts). Importers re-export where a constant is part of
// their public surface (e.g. embedding.ts re-exports VECTOR_SIZE).

/** Embedding vector dimensionality. All providers normalize to this size. */
export const VECTOR_SIZE = 1536;

/** Max texts sent to the embedding API per request. */
export const BATCH_SIZE = 50;

/** Max embedding batches sent concurrently per document (rate-limit friendly). */
export const EMBED_BATCH_CONCURRENCY = 3;

/** Max documents ingested concurrently across the whole process (backpressure). */
export const INGEST_CONCURRENCY = 2;

/** Timeout for a single embedding API call. */
export const EMBEDDING_API_TIMEOUT_MS = 30_000;

/** Timeout for a Qdrant data request (search/upsert/delete). */
export const QDRANT_REQUEST_TIMEOUT_MS = 30_000;

/** Timeout for a Qdrant collection-existence health check. */
export const QDRANT_HEALTHCHECK_TIMEOUT_MS = 10_000;
