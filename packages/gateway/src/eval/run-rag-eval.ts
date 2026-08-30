/**
 * Retrieval evaluation harness.
 *
 *   bun run eval:rag                 # score the current retriever
 *   bun run eval:rag --json out.json # also write machine-readable results
 *   bun run eval:rag --baseline b.json  # compare against an earlier run
 *   bun run eval:rag --k 10          # score at a different retrieval depth
 *   bun run eval:rag --rerank        # recall RECALL_DEPTH, then rerank down to k
 *   bun run eval:rag --user alice    # use that account's own configured embedding key
 *
 * Ingests this repository's `docs/` into an isolated evaluation namespace in
 * Qdrant, runs every golden-set query through the same `searchChunks` the
 * product calls, and scores what came back.
 *
 * This is a tool, not a test: it needs a real embedding key, because a mocked
 * embedder returns vectors with no semantic content and would score noise. It
 * is deliberately kept out of `bun run test` for that reason — CI covers the
 * metric arithmetic in `metrics.test.ts`, which is the part that can silently
 * rot.
 *
 * Why it exists: every future claim that a retrieval change helped needs a
 * number that existed before the change. The published finding on reranking is
 * that gains on someone else's corpus do not transfer to yours — so measuring
 * on this corpus is the only way to know.
 */

import { createProvider } from '@confer/agent-runtime';
import { newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { users } from '../db/schema.js';
import { getEnv } from '../env.js';
import { chunkText } from '../lib/chunker.js';
import { type EmbeddingProvider, embedTexts } from '../lib/embedding.js';
import { getUserLlmKeys, resolveEmbeddingKey } from '../lib/llm-keys.js';
import {
  deleteByKbId,
  ensureCollection,
  type KnowledgeChunk,
  searchChunks,
  upsertChunks,
} from '../lib/qdrant.js';
import { BATCH_SIZE, RECALL_DEPTH } from '../lib/rag-config.js';
import { rerankCandidates } from '../lib/rerank.js';
import { type CaseKind, CORPUS_FILES, DOC_LANG, GOLDEN_SET } from './golden-set.js';
import {
  aggregate,
  type CaseScore,
  EVAL_K,
  type EvalSummary,
  isCrossLingual,
  scoreCase,
} from './metrics.js';

// A namespace of its own so an evaluation run can never read or clobber a real
// owner's knowledge base. Fixed rather than random so a re-run replaces the
// previous corpus instead of accumulating copies of it.
const EVAL_USER_ID = 'eval00000000000000000user';
const EVAL_KB_ID = 'eval000000000000000000kb01';
const EVAL_KB_NAME = 'confer-docs-eval';

const DOCS_DIR = new URL('../../../../docs/', import.meta.url);

interface CaseResult {
  id: string;
  kind: CaseKind;
  crossLingual: boolean;
  query: string;
  expected: string[];
  retrieved: string[];
  score: CaseScore;
}

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * The embedding credential, from the environment rather than the database.
 *
 * Production reads an owner's encrypted key; an evaluation has no owner, and
 * requiring one would mean seeding a user to measure a retriever.
 */
async function resolveKey(): Promise<{ key: string; provider: EmbeddingProvider }> {
  // `--user <username>` scores the retriever with the credential that account
  // actually runs on, picked by the same EMBEDDING_PROVIDER_PRIORITY the
  // product uses. Preferred over an env var when the question is "how does MY
  // instance retrieve": it needs no secret on the command line, where it would
  // land in shell history and in the process list.
  const username = readFlag('--user');
  if (username) {
    const [row] = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    if (!row) {
      console.error(`No such user: ${username}`);
      process.exit(1);
    }
    const resolved = await resolveEmbeddingKey(
      await getUserLlmKeys(row.id),
      getEnv().ENCRYPTION_KEY,
    );
    if (!resolved) {
      console.error(`User ${username} has no usable embedding key configured.`);
      process.exit(1);
    }
    return { key: resolved.apiKey, provider: resolved.provider };
  }

  const provider = (process.env.EVAL_EMBEDDING_PROVIDER ?? 'openai') as EmbeddingProvider;
  const key = process.env.EVAL_EMBEDDING_KEY ?? process.env.OPENAI_API_KEY ?? '';
  if (!key) {
    console.error(
      "No embedding credential. Pass --user <username> to use an account's own key,\n" +
        'or set EVAL_EMBEDDING_KEY (or OPENAI_API_KEY).\n' +
        'For a local runtime set EVAL_EMBEDDING_PROVIDER=ollama and put its base URL in EVAL_EMBEDDING_KEY —\n' +
        'that slot carries an address rather than a secret for providers where the key IS the address.',
    );
    process.exit(1);
  }
  return { key, provider };
}

async function ingestCorpus(key: string, provider: EmbeddingProvider): Promise<number> {
  await ensureCollection();
  // Replace rather than append: a stale copy of a document would keep answering
  // queries after its source changed, and the scores would describe neither.
  await deleteByKbId(EVAL_KB_ID);

  const filenames = CORPUS_FILES;
  let total = 0;

  for (const filename of filenames) {
    const file = Bun.file(new URL(filename, DOCS_DIR));
    if (!(await file.exists())) {
      console.error(
        `Corpus file missing: ${filename} — the golden set annotates a file that is not there.`,
      );
      process.exit(1);
    }

    const chunks = chunkText(await file.text(), newId(), filename, EVAL_KB_ID, EVAL_USER_ID);

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const vectors = await embedTexts(
        batch.map((c) => c.text),
        key,
        provider,
      );
      const points: KnowledgeChunk[] = batch.map((chunk, index) => ({
        ...chunk,
        kb_name: EVAL_KB_NAME,
        vector: vectors[index] as number[],
        provider,
      }));
      await upsertChunks(points);
      total += points.length;
    }
    process.stdout.write(`  ${filename} → ${chunks.length} chunks\n`);
  }
  return total;
}

/**
 * The reranking model, when `--rerank` is passed.
 *
 * Separate from the embedding credential: reranking needs a chat model, and on
 * a local runtime those are different models behind the same address.
 */
function resolveReranker():
  | { provider: ReturnType<typeof createProvider>; model?: string }
  | undefined {
  if (!process.argv.includes('--rerank')) return undefined;
  const name = process.env.EVAL_RERANK_PROVIDER ?? 'ollama';
  const credential = process.env.EVAL_RERANK_KEY ?? 'http://localhost:11434';
  const provider = createProvider(name, credential);
  if (!provider) {
    console.error(`Unknown rerank provider: ${name}`);
    process.exit(1);
  }
  return { provider, model: process.env.EVAL_RERANK_MODEL };
}

async function runCases(
  key: string,
  provider: EmbeddingProvider,
  k: number,
  reranker: ReturnType<typeof resolveReranker>,
): Promise<CaseResult[]> {
  const results: CaseResult[] = [];

  for (const testCase of GOLDEN_SET) {
    const [vector] = await embedTexts([testCase.query], key, provider);
    // The same call the product makes, with the same limit and score floor, so
    // the numbers describe the shipped retriever and not a variant of it.
    // Mirrors what `searchKnowledgeBase` does in production: retrieve wide only
    // when something will narrow it again.
    const depth = reranker ? RECALL_DEPTH : k;
    const hits = await searchChunks(
      vector as number[],
      EVAL_USER_ID,
      [EVAL_KB_ID],
      depth,
      provider,
      0.3,
    );

    const ordered = reranker
      ? (
          await rerankCandidates({
            query: testCase.query,
            candidates: hits.map((hit) => ({ text: hit.text })),
            // biome-ignore lint/style/noNonNullAssertion: resolveReranker exits when it cannot build one
            provider: reranker.provider!,
            model: reranker.model,
            topN: k,
          })
        ).map((index) => hits[index] as (typeof hits)[number])
      : hits;

    // Chunks fold to documents, keeping rank order: relevance is annotated per
    // document, and two chunks of one file are one file.
    const retrieved = [...new Set(ordered.map((hit) => hit.doc_name))];

    results.push({
      id: testCase.id,
      kind: testCase.kind,
      crossLingual: isCrossLingual(testCase.query, testCase.relevantDocs, DOC_LANG, testCase.kind),
      query: testCase.query,
      expected: testCase.relevantDocs,
      retrieved,
      score: scoreCase(testCase.relevantDocs, retrieved, k),
    });
  }
  return results;
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

function summarize(results: CaseResult[]): Record<string, EvalSummary> {
  const kinds: CaseKind[] = ['semantic', 'lexical', 'mixed'];
  const byKind = Object.fromEntries(
    kinds.map((kind) => [
      kind,
      aggregate(results.filter((r) => r.kind === kind).map((r) => r.score)),
    ]),
  );
  // Cross-lingual is cut across the kind buckets, not alongside them: a
  // language-boundary miss and a ranking miss need opposite fixes, and an
  // aggregate hides which one is happening.
  const sameLang = results.filter((r) => !r.crossLingual);
  const crossLang = results.filter((r) => r.crossLingual);

  return {
    ...byKind,
    'same-lang': aggregate(sameLang.map((r) => r.score)),
    'cross-lang': aggregate(crossLang.map((r) => r.score)),
    overall: aggregate(results.map((r) => r.score)),
  };
}

function report(results: CaseResult[], summaries: Record<string, EvalSummary>): void {
  const row = (label: string, s: EvalSummary) =>
    `  ${label.padEnd(9)} ${String(s.cases).padStart(3)}  ` +
    `${pct(s.recall).padStart(7)}  ${pct(s.precision).padStart(7)}  ` +
    `${s.mrr.toFixed(3).padStart(6)}  ${s.ndcg.toFixed(3).padStart(6)}  ${String(s.misses).padStart(4)}`;

  console.log(
    `\n  ${'bucket'.padEnd(9)} ${'n'.padStart(3)}  ${'recall'.padStart(7)}  ${'prec'.padStart(7)}  ${'MRR'.padStart(6)}  ${'nDCG'.padStart(6)}  ${'miss'.padStart(4)}`,
  );
  console.log(`  ${'-'.repeat(52)}`);
  for (const [label, summary] of Object.entries(summaries)) {
    if (label === 'same-lang' || label === 'overall') console.log(`  ${'-'.repeat(52)}`);
    console.log(row(label, summary));
  }

  // Misses are the actionable part: an aggregate says something is wrong, a
  // list of failed queries says what.
  const misses = results.filter((r) => r.score.recall === 0);
  if (misses.length > 0) {
    console.log('\n  Retrieved nothing expected:');
    for (const miss of misses) {
      console.log(`    [${miss.kind}${miss.crossLingual ? ', cross-lang' : ''}] ${miss.query}`);
      console.log(
        `      expected ${miss.expected.join(', ')} | got ${miss.retrieved.join(', ') || '(nothing)'}`,
      );
    }
  }
}

async function compare(current: Record<string, EvalSummary>, baselinePath: string): Promise<void> {
  const baseline = (await Bun.file(baselinePath).json()) as {
    summaries: Record<string, EvalSummary>;
  };
  console.log(`\n  vs ${baselinePath}:`);
  for (const [label, summary] of Object.entries(current)) {
    const before = baseline.summaries[label];
    if (!before) continue;
    const delta = summary.ndcg - before.ndcg;
    const sign = delta > 0 ? '+' : '';
    console.log(
      `    ${label.padEnd(9)} nDCG ${before.ndcg.toFixed(3)} → ${summary.ndcg.toFixed(3)}  (${sign}${delta.toFixed(3)})`,
    );
  }
}

const { key, provider } = await resolveKey();

console.log(`Ingesting corpus (${provider})…`);
const chunkCount = await ingestCorpus(key, provider);
console.log(`Ingested ${chunkCount} chunks from ${CORPUS_FILES.length} documents.`);

const k = Number(readFlag('--k') ?? EVAL_K);
const reranker = resolveReranker();
console.log(
  `\nRunning ${GOLDEN_SET.length} queries at k=${k}` +
    (reranker ? ` (recall ${RECALL_DEPTH} → rerank ${k})` : '') +
    '…',
);
const results = await runCases(key, provider, k, reranker);
const summaries = summarize(results);
report(results, summaries);

const jsonPath = readFlag('--json');
if (jsonPath) {
  await Bun.write(jsonPath, `${JSON.stringify({ provider, k, summaries, results }, null, 2)}\n`);
  console.log(`\n  Wrote ${jsonPath}`);
}

const baselinePath = readFlag('--baseline');
if (baselinePath) await compare(summaries, baselinePath);

console.log('');
