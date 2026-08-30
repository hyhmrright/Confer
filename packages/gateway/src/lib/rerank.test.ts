import { describe, expect, test } from 'bun:test';
import type { LLMMessage, LLMProvider, LLMStreamEvent } from '@confer/agent-runtime';
import { parseRankedIndices, rerankCandidates } from './rerank.js';

// A provider is an injected argument, so a stub suffices — no mock.module,
// which in this package poisons getDb/getEnv process-wide and takes the
// real-stack integration tests down with it.
function stubProvider(reply: string | (() => never)): LLMProvider {
  return {
    name: 'stub',
    chat: async () => {
      throw new Error('not used');
    },
    async *stream(_messages: LLMMessage[]): AsyncIterable<LLMStreamEvent> {
      if (typeof reply === 'function') reply();
      yield { type: 'token', text: reply as string } as LLMStreamEvent;
    },
  };
}

const candidates = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `passage ${i}` }));

describe('parseRankedIndices', () => {
  test('converts the model 1-based numbering to array indices', () => {
    expect(parseRankedIndices('[3,1,2]', 5)).toEqual([2, 0, 1]);
  });

  test('finds the array inside prose or a code fence', () => {
    // Models wrap JSON however firmly they are told not to, and a formatting
    // quirk must not cost the turn its ranking.
    expect(parseRankedIndices('Here you go:\n```json\n[2,1]\n```', 3)).toEqual([1, 0]);
    expect(parseRankedIndices('The most relevant are [1] and nothing else.', 3)).toEqual([0]);
  });

  test('drops indices the model invented', () => {
    // An out-of-range index would otherwise select a passage at random or read
    // past the end of the array.
    expect(parseRankedIndices('[1,99,2]', 3)).toEqual([0, 1]);
    expect(parseRankedIndices('[0]', 3)).toEqual([]);
    expect(parseRankedIndices('[-1,2]', 3)).toEqual([1]);
  });

  test('drops duplicates so one passage cannot occupy two slots', () => {
    expect(parseRankedIndices('[2,2,1]', 3)).toEqual([1, 0]);
  });

  test('drops non-integers rather than coercing them', () => {
    expect(parseRankedIndices('[1.5,2]', 3)).toEqual([1]);
    expect(parseRankedIndices('["a",2]', 3)).toEqual([1]);
  });

  test('reads the array out of an object the model wrapped it in', () => {
    // `{"ranked":[2,1]}` is the right answer in the wrong shape, and the intent
    // is unambiguous. Refusing it would throw away a usable ranking over
    // formatting — the opposite of why the parsing is lenient.
    expect(parseRankedIndices('{"ranked":[2,1]}', 3)).toEqual([1, 0]);
  });

  test('returns nothing for a reply with no usable array', () => {
    expect(parseRankedIndices('I cannot rank these.', 3)).toEqual([]);
    expect(parseRankedIndices('[not json]', 3)).toEqual([]);
  });
});

describe('rerankCandidates', () => {
  const base = { query: 'q', model: 'm', topN: 3 };

  test('returns the model ordering, truncated to topN', async () => {
    const order = await rerankCandidates({
      ...base,
      candidates: candidates(5),
      provider: stubProvider('[4,2,5,1]'),
    });
    expect(order).toEqual([3, 1, 4]);
  });

  test('keeps fewer than topN when the model rejected the rest', async () => {
    // Dropping irrelevant passages is the point of reranking, so a short list
    // is a real answer rather than a truncated one.
    const order = await rerankCandidates({
      ...base,
      candidates: candidates(5),
      provider: stubProvider('[2]'),
    });
    expect(order).toEqual([1]);
  });

  test('falls back to vector order when the provider throws', async () => {
    const order = await rerankCandidates({
      ...base,
      candidates: candidates(5),
      provider: stubProvider(() => {
        throw new Error('502 from vendor');
      }),
    });
    // Reranking is never load-bearing: a bad provider response must degrade
    // the ranking, never the answer.
    expect(order).toEqual([0, 1, 2]);
  });

  test('falls back to vector order on an unparseable reply', async () => {
    const order = await rerankCandidates({
      ...base,
      candidates: candidates(5),
      provider: stubProvider('sorry, I cannot do that'),
    });
    // An empty parse means the reply was unusable, NOT that every passage was
    // irrelevant — treating those alike would strip the turn of its context.
    expect(order).toEqual([0, 1, 2]);
  });

  test('does not call the model when there is nothing to reorder', async () => {
    const exploding = stubProvider(() => {
      throw new Error('should not be called');
    });
    expect(
      await rerankCandidates({ ...base, candidates: candidates(1), provider: exploding }),
    ).toEqual([0]);
    expect(await rerankCandidates({ ...base, candidates: [], provider: exploding })).toEqual([]);
  });
});
