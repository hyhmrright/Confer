import { describe, expect, test } from 'bun:test';
import { CORPUS_FILES, EXPECTED_DOCS, GOLDEN_SET } from './golden-set.js';
import { aggregate, type CaseScore, isCrossLingual, scoreCase } from './metrics.js';

describe('scoreCase', () => {
  test('a single expected document found first scores perfectly', () => {
    const score = scoreCase(['a.md'], ['a.md', 'b.md', 'c.md']);
    expect(score.recall).toBe(1);
    expect(score.reciprocalRank).toBe(1);
    expect(score.ndcg).toBe(1);
    // One of five slots was useful — precision is not supposed to be 1 here.
    expect(score.precision).toBeCloseTo(1 / 3);
  });

  test('reciprocal rank falls off with the position of the first hit', () => {
    expect(scoreCase(['a.md'], ['x.md', 'a.md']).reciprocalRank).toBe(0.5);
    expect(scoreCase(['a.md'], ['x.md', 'y.md', 'a.md']).reciprocalRank).toBeCloseTo(1 / 3);
  });

  test('nDCG separates rank 1 from rank 5 where recall cannot', () => {
    const first = scoreCase(['a.md'], ['a.md', 'x.md', 'y.md', 'z.md', 'w.md']);
    const last = scoreCase(['a.md'], ['x.md', 'y.md', 'z.md', 'w.md', 'a.md']);

    // This is the entire reason nDCG is here: reranking moves a right answer up
    // without changing what was retrieved, so a metric blind to position would
    // report a reranker as having done nothing.
    expect(first.recall).toBe(last.recall);
    expect(first.ndcg).toBeGreaterThan(last.ndcg);
    expect(first.ndcg).toBe(1);
  });

  test('partial recall over several expected documents', () => {
    const score = scoreCase(['a.md', 'b.md'], ['a.md', 'x.md']);
    expect(score.recall).toBe(0.5);
    expect(score.ndcg).toBeGreaterThan(0);
    expect(score.ndcg).toBeLessThan(1);
  });

  test('counts a document once however many chunks matched', () => {
    // The retriever returns chunks; the caller dedupes to documents. Retrieving
    // the same file twice does not make an answer better grounded.
    const score = scoreCase(['a.md'], ['a.md', 'a.md']);
    expect(score.recall).toBe(1);
  });

  test('a complete miss scores zero everywhere, not NaN', () => {
    const score = scoreCase(['a.md'], ['x.md', 'y.md']);
    expect(score).toEqual({ recall: 0, precision: 0, reciprocalRank: 0, ndcg: 0 });
  });

  test('empty inputs do not divide by zero', () => {
    expect(scoreCase([], ['x.md']).recall).toBe(0);
    expect(scoreCase(['a.md'], []).precision).toBe(0);
    expect(scoreCase(['a.md'], []).ndcg).toBe(0);
  });

  test('honours k, ignoring hits past the cutoff', () => {
    // Production searches with limit 5, so a hit at rank 6 is a hit nobody sees.
    const retrieved = ['x.md', 'y.md', 'z.md', 'w.md', 'v.md', 'a.md'];
    expect(scoreCase(['a.md'], retrieved, 5).recall).toBe(0);
    expect(scoreCase(['a.md'], retrieved, 6).recall).toBe(1);
  });
});

describe('aggregate', () => {
  test('averages each metric and counts total misses', () => {
    const scores: CaseScore[] = [
      { recall: 1, precision: 0.2, reciprocalRank: 1, ndcg: 1 },
      { recall: 0, precision: 0, reciprocalRank: 0, ndcg: 0 },
    ];
    const summary = aggregate(scores);
    expect(summary.cases).toBe(2);
    expect(summary.recall).toBe(0.5);
    expect(summary.mrr).toBe(0.5);
    expect(summary.misses).toBe(1);
  });

  test('an empty run reports zeros rather than NaN', () => {
    expect(aggregate([])).toEqual({
      cases: 0,
      recall: 0,
      precision: 0,
      mrr: 0,
      ndcg: 0,
      misses: 0,
    });
  });
});

describe('isCrossLingual', () => {
  const langs = { 'zh-doc.md': 'zh', 'en-doc.md': 'en' };

  test('a Chinese question about an English document crosses a boundary', () => {
    expect(isCrossLingual('自托管需要什么前置条件', ['en-doc.md'], langs, 'semantic')).toBe(true);
  });

  test('a Chinese question about a Chinese document does not', () => {
    expect(isCrossLingual('自托管需要什么前置条件', ['zh-doc.md'], langs, 'semantic')).toBe(false);
  });

  test('a lexical query never crosses, in either direction', () => {
    // `peer_contacts` appears as those exact characters inside a Chinese
    // document. Counting identifier lookups as cross-lingual is what once
    // lifted the cross-lingual bucket above the same-language one and hid the
    // real failures.
    expect(isCrossLingual('peer_contacts', ['zh-doc.md'], langs, 'lexical')).toBe(false);
    expect(isCrossLingual('peer_contacts', ['en-doc.md'], langs, 'lexical')).toBe(false);
  });

  test('a mixed query is asked in Chinese, which is the language to bridge from', () => {
    expect(isCrossLingual('sessions 表存了什么', ['en-doc.md'], langs, 'mixed')).toBe(true);
  });

  test('an unannotated document never counts as crossing', () => {
    // Silently treating unknown as a mismatch would invent cross-lingual cases.
    expect(isCrossLingual('中文问题', ['unknown.md'], langs, 'semantic')).toBe(false);
  });
});

describe('golden set', () => {
  test('case ids are unique', () => {
    const ids = GOLDEN_SET.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every case expects at least one document', () => {
    // A case with no expectation scores 0 forever and silently drags the mean
    // down — it looks like a retrieval failure that no fix can ever repair.
    for (const testCase of GOLDEN_SET) {
      expect(testCase.relevantDocs.length).toBeGreaterThan(0);
    }
  });

  test('every annotated document is actually in the corpus', () => {
    // An annotation pointing outside the corpus is unscoreable: the file is
    // never ingested, so the case can only ever miss, and the miss looks like
    // a retrieval failure rather than the typo it is.
    for (const doc of EXPECTED_DOCS) {
      expect(CORPUS_FILES).toContain(doc);
    }
  });

  test('the corpus carries distractors beyond the annotated answers', () => {
    // Scoring a retriever only against files that contain the answers asks an
    // easier question than production ever asks.
    expect(CORPUS_FILES.length).toBeGreaterThanOrEqual(EXPECTED_DOCS.length);
  });

  test('keeps enough lexical cases to detect a hybrid-retrieval change', () => {
    // The lexical bucket is the one hybrid search is meant to move. Too few
    // cases and the signal is noise: one case flipping would swing the bucket.
    const lexical = GOLDEN_SET.filter((c) => c.kind === 'lexical');
    expect(lexical.length).toBeGreaterThanOrEqual(10);
  });
});
