import type { LLMProvider } from '@confer/agent-runtime';
import { RERANK_TIMEOUT_MS } from './rag-config.js';

/**
 * Rerank retrieved chunks with the LLM the agent already runs on.
 *
 * Why this exists, measured rather than assumed (`src/eval/README.md`): at the
 * production depth of 5, same-language recall on the eval corpus is 84% and
 * four queries miss entirely. At depth 20 recall is 100% and nothing misses —
 * every right answer was already being retrieved, just ranked between 7th and
 * 16th, with a similarity gap of about 0.07 from the wrong document above it.
 * Embedding similarity cannot separate those; a model reading the question and
 * the passage together can.
 *
 * The cost of retrieving 20 is precision falling from 29.5% to 14.9%, which is
 * exactly what this hands back — recall wide, then narrow by relevance.
 *
 * Deliberately reuses the owner's configured provider rather than adding a
 * dedicated reranking vendor. A cross-encoder or Cohere Rerank would score
 * better, but each adds a key slot to configure and a service to reach, and
 * this product's premise is that an owner brings one credential. Revisit if
 * the eval says this is the ceiling.
 *
 * Reranking is never load-bearing: every failure path returns the vector order
 * unchanged, so a bad provider response degrades the ranking rather than the
 * answer.
 */

/** What the model is asked to rank. `text` is the passage; nothing else is sent. */
export interface RerankCandidate {
  text: string;
}

const SYSTEM_PROMPT =
  'You rank passages by how well they answer a question. ' +
  'Reply with ONLY a JSON array of passage numbers, most relevant first, ' +
  'e.g. [3,1,7]. Omit passages that do not help answer the question. ' +
  'No prose, no code fences.';

// Long enough that a passage is recognizable, short enough that 20 of them do
// not become a prompt more expensive than the answer itself.
const EXCERPT_CHARS = 400;

function buildUserPrompt(query: string, candidates: RerankCandidate[]): string {
  const passages = candidates
    .map((candidate, index) => `[${index + 1}] ${candidate.text.slice(0, EXCERPT_CHARS)}`)
    .join('\n\n');
  return `Question: ${query}\n\nPassages:\n${passages}`;
}

/**
 * Parse the model's reply into candidate indices.
 *
 * Tolerant on purpose: models wrap JSON in prose or fences however firmly they
 * are told not to, and a formatting quirk must not cost the turn its ranking.
 * The first bracketed group is taken, then every entry is validated — out of
 * range, duplicated, and non-integer values are dropped rather than trusted,
 * because an index the model invented would otherwise pick a passage at random
 * or throw on a missing element.
 */
export function parseRankedIndices(reply: string, candidateCount: number): number[] {
  const match = reply.match(/\[[^\]]*\]/);
  if (!match) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<number>();
  const indices: number[] = [];
  for (const entry of parsed) {
    // The prompt numbers passages from 1; the array is 0-based.
    const index = Number(entry) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= candidateCount) continue;
    if (seen.has(index)) continue;
    seen.add(index);
    indices.push(index);
  }
  return indices;
}

export interface RerankOptions {
  query: string;
  candidates: RerankCandidate[];
  provider: LLMProvider;
  model?: string;
  /** How many to return. Fewer come back if the model rejected the rest as irrelevant. */
  topN: number;
}

/**
 * Return the indices of the best `topN` candidates, best first.
 *
 * Falls back to the incoming order — which is vector similarity, already a
 * reasonable ranking — whenever the model is unavailable, slow, or unparseable.
 * The caller cannot tell the difference apart from the log line, which is the
 * point: this improves an answer, it is not required to produce one.
 */
export async function rerankCandidates(options: RerankOptions): Promise<number[]> {
  const { query, candidates, provider, model, topN } = options;

  const identity = candidates.map((_, index) => index).slice(0, topN);
  // One candidate cannot be misordered, and zero has nothing to rank. Skipping
  // the call is not an optimization here — it avoids spending a model call to
  // learn something already known.
  if (candidates.length <= 1) return identity;

  try {
    const reply = await withTimeout(
      collectReply(provider, model, query, candidates),
      RERANK_TIMEOUT_MS,
    );
    const ranked = parseRankedIndices(reply, candidates.length);

    // An empty result means the model answered nothing usable — not that every
    // passage was irrelevant. Treating those the same would silently strip a
    // turn of its context on a parse failure.
    if (ranked.length === 0) return identity;

    return ranked.slice(0, topN);
  } catch (err) {
    console.warn(
      `rerank failed, keeping vector order: ${err instanceof Error ? err.message : err}`,
    );
    return identity;
  }
}

async function collectReply(
  provider: LLMProvider,
  model: string | undefined,
  query: string,
  candidates: RerankCandidate[],
): Promise<string> {
  let reply = '';
  for await (const event of provider.stream(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(query, candidates) },
    ],
    { model },
  )) {
    if (event.type === 'token' && event.text) reply += event.text;
  }
  return reply;
}

/**
 * Bound the wait.
 *
 * No LLM call in this codebase has a timeout of its own, and a reranker is a
 * step between a question and its answer — a hung provider here would stall the
 * turn to produce an improvement the turn can do without.
 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`rerank timed out after ${ms}ms`)), ms),
    ),
  ]);
}
