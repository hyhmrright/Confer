// Retrieval metrics for the RAG evaluation harness.
//
// Pure functions with no infrastructure, so the arithmetic that every future
// "this optimization helped" claim rests on is itself covered by unit tests.
// The harness that actually calls a retriever lives in `run-rag-eval.ts`.
//
// Relevance is binary and judged at the document level, not the chunk level:
// the golden set names which files should answer a question, and the retriever
// returns chunks. Chunk-level judgements would need re-annotating every time
// CHUNK_SIZE changes, which is precisely the kind of thing an eval must survive
// in order to be worth keeping.

/**
 * How many retrieved documents each metric considers.
 *
 * Set to the `limit` that `searchChunks` runs with in production, so the scores
 * describe the real system rather than a more generous hypothetical one. Note
 * the unit changes on the way in: production retrieves 5 *chunks*, which may
 * come from fewer documents, and the harness folds them to documents before
 * scoring. So k rarely truncates anything — it is the ceiling, and the real
 * bound is what production already returned.
 */
export const EVAL_K = 5;

export interface CaseScore {
  /** Share of the expected documents that appear in the top-k. */
  recall: number;
  /** Share of the top-k that was expected — low precision still costs context budget and dilutes the prompt. */
  precision: number;
  /** Reciprocal rank of the first expected document, 0 if none appear. */
  reciprocalRank: number;
  /** Normalized discounted cumulative gain: unlike recall, this moves when a right answer merely ranks higher. */
  ndcg: number;
}

export interface EvalSummary {
  cases: number;
  recall: number;
  precision: number;
  mrr: number;
  ndcg: number;
  /** Cases where nothing expected was retrieved at all — the failures worth reading individually. */
  misses: number;
}

/**
 * Score one query.
 *
 * `retrieved` is ordered best-first and holds document identifiers. Repeats are
 * dropped here, keeping first occurrence: a retriever returns chunks, and
 * several chunks of one document are one document — retrieving the same file
 * twice does not make an answer better grounded. Deduplicating inside rather
 * than requiring it of the caller is deliberate; the alternative lets a forgetful
 * caller compute a recall above 1, and a metric that can report 200% is not a
 * metric anyone should reason from.
 */
export function scoreCase(relevant: string[], retrieved: string[], k: number = EVAL_K): CaseScore {
  const expected = new Set(relevant);
  const topK = [...new Set(retrieved)].slice(0, k);
  const hits = topK.filter((doc) => expected.has(doc));

  const firstHit = topK.findIndex((doc) => expected.has(doc));

  return {
    // An empty expectation would divide by zero; a case that expects nothing is
    // a malformed case, and scoring it 0 would silently drag the average down.
    recall: expected.size === 0 ? 0 : hits.length / expected.size,
    precision: topK.length === 0 ? 0 : hits.length / topK.length,
    reciprocalRank: firstHit === -1 ? 0 : 1 / (firstHit + 1),
    ndcg: ndcgAt(topK, expected, k),
  };
}

/**
 * Binary-relevance nDCG.
 *
 * The ideal ranking puts every expected document first, so IDCG sums the same
 * discount over `min(|expected|, k)` positions. Worth having alongside recall
 * because recall cannot tell "right answer at rank 1" from "right answer at
 * rank 5", and reranking only ever moves the latter to the former.
 */
function ndcgAt(topK: string[], expected: Set<string>, k: number): number {
  const discount = (index: number) => 1 / Math.log2(index + 2);

  let dcg = 0;
  for (const [index, doc] of topK.entries()) {
    if (expected.has(doc)) dcg += discount(index);
  }

  let idcg = 0;
  for (let i = 0; i < Math.min(expected.size, k); i++) idcg += discount(i);

  return idcg === 0 ? 0 : dcg / idcg;
}

/**
 * Whether answering this query requires the embedding to bridge two languages.
 *
 * Reported separately because same-language and cross-language misses need
 * opposite fixes. A same-language miss is a ranking problem — the right
 * document was found but ranked below the cutoff — and deeper recall plus a
 * reranker addresses it. A cross-language miss means the model has no shared
 * space across the two languages, and no reranker can promote a document that
 * retrieval never surfaced at any depth.
 *
 * A lexical query never counts, whatever script it is written in. `peer_contacts`
 * appears as those exact characters inside a Chinese document, so it matches
 * literally and no boundary is being crossed. Counting them was this function's
 * first bug: twelve full-marks identifier lookups landed in the cross-lingual
 * bucket and lifted it *above* the same-language bucket, hiding the two real
 * failures inside an average that looked healthy.
 *
 * Everything else is judged by the query's own script: any CJK ideograph makes
 * it a Chinese question, including a mixed one like "sessions 表存了什么" —
 * Chinese is the language the embedding has to bridge from.
 */
export function isCrossLingual(
  query: string,
  relevantDocs: string[],
  docLang: Record<string, string>,
  kind: 'semantic' | 'lexical' | 'mixed',
): boolean {
  if (kind === 'lexical') return false;
  const queryLang = /\p{Script=Han}/u.test(query) ? 'zh' : 'en';
  return relevantDocs.some((doc) => docLang[doc] !== undefined && docLang[doc] !== queryLang);
}

/** Mean of each metric across cases, plus a count of total misses. */
export function aggregate(scores: CaseScore[]): EvalSummary {
  if (scores.length === 0) {
    return { cases: 0, recall: 0, precision: 0, mrr: 0, ndcg: 0, misses: 0 };
  }
  const mean = (pick: (score: CaseScore) => number) =>
    scores.reduce((sum, score) => sum + pick(score), 0) / scores.length;

  return {
    cases: scores.length,
    recall: mean((s) => s.recall),
    precision: mean((s) => s.precision),
    mrr: mean((s) => s.reciprocalRank),
    ndcg: mean((s) => s.ndcg),
    misses: scores.filter((s) => s.recall === 0).length,
  };
}
