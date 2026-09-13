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
 * document before returning a character. The OOXML budgets below do that.
 */
export const MAX_EXTRACTED_CHARS = 2_000_000;

/**
 * How far a .docx/.xlsx may expand before a parser is handed it
 * (`assertOoxmlWithinBudget`).
 *
 * Both parsers hold the whole document in memory at a multiple of its XML that
 * the compressed upload size says nothing about. Measured on bun 1.4: mammoth
 * peaked at 2.8 GB of RSS on 20 MB of paragraph XML that zipped to 130 KB, and
 * 6.9 GB on 60 MB; exceljs at 1.2 GB on 20 MB of sheet XML. One upload was
 * enough to take down the gateway's only process.
 *
 * What the parsers spend memory on is nodes, so the tight budget is markup —
 * the `<` and `=` bytes that open every element and carry every attribute —
 * rather than bytes. At 500,000 the densest shape measured peaked at 611 MB
 * (mammoth, 3.5 MB of `<w:p><w:r><w:t>` runs); an attribute flood at 236 MB;
 * exceljs held 250,000 cells in 487 MB at twice that. Ordinary Word XML runs
 * at roughly 17 markup bytes per 280, so that is a document of several hundred
 * pages, about where its text would pass MAX_EXTRACTED_CHARS anyway. The byte
 * budget is the looser one and exists for images, which parse to little more
 * than their own size: room for a 10 MB upload that is mostly pictures.
 */
export const MAX_OOXML_MARKUP = 500_000;
export const MAX_OOXML_TOTAL_BYTES = 32 * 1024 * 1024;
/** A real document has dozens of parts; the zip reader keeps an object for each. */
export const MAX_OOXML_ENTRIES = 5_000;
