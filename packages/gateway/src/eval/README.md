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

## Baseline: ollama / nomic-embed-text

`baselines/ollama-nomic-embed-text.json`, 2026-08-30:

| bucket | n | recall | nDCG | miss |
|---|---|---|---|---|
| semantic | 12 | 33.3% | 0.292 | 8 |
| lexical | 12 | 100.0% | 0.874 | 0 |
| mixed | 6 | 83.3% | 0.667 | 1 |
| same-lang | 25 | 84.0% | 0.720 | 4 |
| **cross-lang** | **5** | **0.0%** | **0.000** | **5** |
| overall | 30 | 70.0% | 0.600 | 9 |

Two findings, and both inverted an assumption that had been made from reading
the code rather than measuring it.

**Lexical retrieval is not the problem — it is perfect.** The plan had been to
add hybrid search (BM25 + RRF) because dense retrieval is known to blur exact
identifiers. On this corpus it scores 100%, so hybrid search would have been
work spent on the one bucket with nothing wrong with it.

**Cross-lingual retrieval is total failure, not degradation.** Five Chinese
questions whose answers live in the corpus's one English document
(`09-deployment.md`, 2 CJK characters in 19,320): none retrieved, at any rank. A
depth-50 probe puts the right document past rank 50, while same-language misses
sit at rank 7–16 with a score gap of ~0.07 — those are recoverable by deeper
recall plus a reranker, and this is not.

This matters beyond the eval corpus. Confer ships in three languages, owners'
knowledge bases are mixed by nature, and `ollama` is the last entry in
`EMBEDDING_PROVIDER_PRIORITY` precisely so that a purely local install still has
embeddings. So the default local configuration cannot retrieve across languages
at all, and it fails silently — the search returns *something*, just never the
right document.

Re-run with a hosted multilingual model before concluding anything about them;
this baseline describes `nomic-embed-text`, not the product's ceiling.
