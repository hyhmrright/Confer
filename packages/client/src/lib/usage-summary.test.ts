import { describe, expect, test } from 'bun:test';
import { shiftMonth, summarizeUsage, type UsageRow } from './usage-summary.js';

function row(overrides: Partial<UsageRow>): UsageRow {
  return {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    audience: 'owner',
    turns: 1,
    unreported: 0,
    failed: 0,
    input_tokens: 100,
    output_tokens: 10,
    cache_read_tokens: null,
    cache_write_tokens: null,
    ...overrides,
  };
}

describe('summarizeUsage', () => {
  test('folds the audience split into one line per model, largest first', () => {
    const summary = summarizeUsage([
      row({ turns: 2 }),
      row({ audience: 'peer', turns: 3, input_tokens: 50, output_tokens: 5 }),
      row({ provider: 'deepseek', model: null, input_tokens: 1000, output_tokens: 100 }),
    ]);

    expect(summary.turns).toBe(6);
    expect(summary.peerTurns).toBe(3);
    expect(summary.inputTokens).toBe(1150);
    expect(summary.byModel).toEqual([
      { provider: 'deepseek', model: null, turns: 1, inputTokens: 1000, outputTokens: 100 },
      { provider: 'openai', model: 'gpt-4.1-mini', turns: 5, inputTokens: 150, outputTokens: 15 },
    ]);
  });

  test('keeps a group whose vendor reported nothing out of the token totals', () => {
    const summary = summarizeUsage([
      row({}),
      row({ unreported: 4, turns: 4, input_tokens: null, output_tokens: null }),
      row({ provider: 'ollama', model: null, input_tokens: null, output_tokens: null }),
    ]);
    expect(summary.unreported).toBe(4);
    expect(summary.inputTokens).toBe(100);
    // A model whose vendor never reported usage is unknown, not zero.
    expect(summary.byModel.find((l) => l.provider === 'ollama')).toMatchObject({
      inputTokens: null,
      outputTokens: null,
    });
  });

  // No vendor said anything about caching: that is unknown, not a 0% hit rate.
  test('reports no cache hit rate when no vendor reported cache hits', () => {
    expect(summarizeUsage([row({})]).cacheHitRate).toBeNull();
  });

  // A vendor silent about caching must not dilute one that reports it.
  test('computes the cache hit rate only against input that reported caching', () => {
    const summary = summarizeUsage([
      row({ cache_read_tokens: 75 }),
      row({ provider: 'deepseek', input_tokens: 900 }),
    ]);
    expect(summary.cacheHitRate).toBe(75 / 100);
  });
});

describe('shiftMonth', () => {
  test('crosses a year boundary in both directions', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-09', 0)).toBe('2026-09');
  });
});
