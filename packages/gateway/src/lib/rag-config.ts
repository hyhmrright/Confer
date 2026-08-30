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

/**
 * Ceiling on the text one document may contribute to the pipeline.
 *
 * The upload route caps the *compressed* upload at 10 MB, which says nothing
 * about how much text comes out: docx and xlsx are zip archives of XML, so a
 * conforming 10 MB file can expand to gigabytes. Nothing downstream bounds it —
 * `chunkText` splits whatever it is handed into 800-char chunks and every chunk
 * becomes an embedding API call and a Qdrant point.
 *
 * 2M characters is roughly 2,500 chunks, well past any real document (a
 * 300-page book is ~600K) and far below the point where one upload can spend
 * the owner's embedding budget.
 *
 * Scope worth being exact about: this bounds what leaves the parser, so it
 * bounds embedding spend and Qdrant growth. It does NOT bound the memory the
 * parse itself takes — both `mammoth` and `exceljs` materialize the whole
 * document before returning a character. Bounding that needs streaming
 * extraction, which neither library does by default.
 */
export const MAX_EXTRACTED_CHARS = 2_000_000;
