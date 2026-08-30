# Retrieval evaluation

A number that exists *before* a change, so any claim that a retrieval change
helped can be checked instead of asserted. The published finding on reranking is
that gains measured on someone else's corpus do not transfer to yours — so the
only honest way to know is to measure on this one.

## Running it

```bash
EVAL_EMBEDDING_PROVIDER=ollama \
EVAL_EMBEDDING_KEY=http://localhost:11434 \
QDRANT_URL=http://localhost:6335 \
bun run eval:rag
```

`EVAL_EMBEDDING_KEY` is an API key for hosted providers and a **base URL** for
local runtimes, matching the slot reuse in `lib/embedding.ts`. Point
`QDRANT_URL` at the test stack (6335) rather than the dev one, so a run cannot
touch real data; the corpus is written under a fixed evaluation user and kb id
either way.

| flag | effect |
|---|---|
| `--json out.json` | write machine-readable results |
| `--baseline b.json` | print nDCG deltas against an earlier run |

It needs a real embedding credential and is therefore **not** part of
`bun run test` — a mocked embedder returns vectors with no semantic content and
would score noise. CI covers `metrics.ts`, which is the part that can rot
silently.

## What it measures

The corpus is this repository's own `docs/` — nine real technical documents.
27+ queries are annotated with the documents that should answer them, scored at
`k=5` (production's `searchChunks` limit) on recall, precision, MRR and nDCG.

Buckets are the point. Report them separately, never just the aggregate:

- **semantic / lexical / mixed** — natural phrasing, exact identifiers, and the
  mix people actually type. Hybrid retrieval is supposed to move *lexical*.
- **same-lang / cross-lang** — cuts across the above. A same-language miss is a
  ranking problem; a cross-language miss means the embedding has no shared space
  between the two languages, and no reranker can promote a document that
  retrieval never surfaced at any depth.

## Baselines: the embedding model dominates everything else

Same corpus, same code, same `k=5`. Only the embedding provider differs
(`baselines/*.json`, 2026-08-30):

| bucket | ollama / nomic-embed-text | glm | Δ recall |
|---|---|---|---|
| semantic | 33.3% | **75.0%** | +41.7pt |
| lexical | 100.0% | 100.0% | — |
| mixed | 83.3% | **100.0%** | +16.7pt |
| same-lang | 84.0% | **100.0%** (0 misses) | +16.0pt |
| cross-lang | **0.0%** | **40.0%** | +40.0pt |
| **overall** | 70.0% (nDCG 0.600) | **90.0%** (nDCG 0.805) | +20.0pt |

Three findings, and the first two inverted assumptions that had been made from
reading the code rather than measuring it.

**Lexical retrieval was never the problem — it is perfect on both.** The plan
had been to add hybrid search (BM25 + RRF), because dense retrieval is known to
blur exact identifiers. It scores 100% on this corpus with either model, so
hybrid search would have been work spent on the one bucket with nothing wrong
with it.

**Choosing the embedding model outranks every retrieval technique available
here.** Swapping it moved overall recall 20 points and nDCG 0.205 — more than
depth, reranking, or hybrid could offer, and it costs a configuration change
rather than a subsystem. Measure this first, before building anything.

**Cross-lingual is the last real weakness, and it is the one that survives.**
The corpus's only English document (`09-deployment.md` — 2 CJK characters in
19,320) is unreachable from a Chinese question under `nomic-embed-text` at *any*
depth: a depth-50 probe puts it past rank 50, while same-language misses sit at
rank 7–16 with a score gap of ~0.07. GLM lifts it to 40%, which is the
difference between broken and merely weak, but 3 of 5 still miss.

This is not an artifact of the corpus. Confer ships in three languages, owners'
knowledge bases are mixed by nature, and `ollama` is deliberately last in
`EMBEDDING_PROVIDER_PRIORITY` so a purely local install still has embeddings —
so the all-local configuration is exactly the one that cannot retrieve across
languages, and it fails silently: search returns *something*, never the right
document.

## Retrieval depth

Under `nomic-embed-text`, varying only `k` (GLM needs none of this — it already
finds everything same-language at `k=5`):

| k | same-lang recall | same-lang misses | precision |
|---|---|---|---|
| 5 | 84.0% | 4 | 29.5% |
| 10 | 88.0% | 3 | 18.6% |
| 20 | **100.0%** | **0** | 14.9% |

Every same-language answer is already being retrieved by depth 20 — the four
misses at depth 5 sit at ranks 7, 11, 12 and 16, with a similarity gap of about
0.07 from the wrong document above them. That is a ranking problem, and the
textbook fix is to recall wide and rerank down. Cross-lingual stays at 0.0% at
every depth, which is the same result from a different angle: a reranker cannot
promote what retrieval never surfaced.

## Reranking: implemented, off by default

`lib/rerank.ts` does this — recall `RECALL_DEPTH`, rerank to `RERANK_TO` with
the agent's own model — behind `RERANK_ENABLED`, which defaults to **false**.
Enable it only after running `bun run eval:rag --rerank` against the model you
actually serve:

```bash
EVAL_RERANK_PROVIDER=ollama EVAL_RERANK_KEY=http://localhost:11434 \
EVAL_RERANK_MODEL=<model> bun run eval:rag --rerank
```

The default is off because measurement did not support turning it on. Against a
local 27B (`qwen3.8:27b-mlx`):

| candidates | latency | reply |
|---|---|---|
| 5 | 28.2s | `[1, 2, 3, 4, 5]` — input order, unchanged |
| 10 | 15.7s | `[1,2,…,10]` — input order, unchanged |
| 20 | 19.5s | `[]` — gave up |

Two failures at once: far past any interactive budget (the timeout is 8s, so all
30 queries fell back to vector order and scored identically to the baseline),
and no actual reranking — the model echoed the numbering back. A capable hosted
model may well do better; that has not been measured here, and shipping it on by
default would have been asserting an improvement rather than showing one.

What the fallback path did demonstrate is that it works: 30 consecutive timeouts
produced scores identical to the baseline, which is what "reranking is never
load-bearing" is supposed to mean.

The GLM run then removed the premise as well. Reranking exists to fix a ranking
problem, and under GLM there is no ranking problem left to fix: same-language
recall is already 100% at `k=5`, with precision at 49.7% rather than the 29.5%
that made retrieving 20 look attractive. On a competent embedding model the
recall headroom this was built for does not exist. Keep it off unless your own
eval run shows the headroom on *your* corpus and *your* model.
