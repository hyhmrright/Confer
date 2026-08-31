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
 * How many chunks the vector search retrieves before reranking.
 *
 * Measured, not guessed (`src/eval/README.md`): on the eval corpus,
 * same-language recall is 84% at depth 5 and 100% at depth 20 — every right
 * answer was already being found, ranked 7th to 16th. Depth 10 only reaches
 * 88%, so 20 is where the recall ceiling actually is here.
 */
export const RECALL_DEPTH = 20;

/**
 * How many chunks survive reranking and reach the model.
 *
 * Unchanged from what the retriever used to return directly, so reranking
 * changes which passages reach the prompt without changing how many — the
 * context budget and the citation count stay where they were.
 */
export const RERANK_TO = 5;

/**
 * Extra result slots reserved for documents whose language differs from the query's.
 *
 * Measured on the eval corpus: with no allowance, Chinese questions whose
 * answer lives in the corpus's one English document rank 7th, 15th and 19th —
 * cross-lingual recall 40%. Raising `topK` to 20 fixes recall but costs
 * precision on every search, including the single-language ones that never had
 * the problem. Three slots buys the same recall for one extra vector query.
 */
export const CROSS_LINGUAL_SLOTS = 3;

/**
 * Timeout for the reranking call.
 *
 * Sits between a question and its answer, so it must fail fast: the ranking it
 * produces is an improvement the turn can do without, and no LLM call in this
 * codebase has a timeout of its own.
 */
export const RERANK_TIMEOUT_MS = 8_000;

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
