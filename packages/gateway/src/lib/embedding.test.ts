import { describe, expect, test } from 'bun:test';
import { EMBEDDING_PROVIDER_PRIORITY, VECTOR_SIZE, embedTexts } from './embedding.js';

describe('embedding contracts', () => {
  test('auto-select priority is openai -> glm -> qwen', () => {
    // Contract: first provider with a user-configured key wins, in this order.
    expect(EMBEDDING_PROVIDER_PRIORITY).toEqual(['openai', 'glm', 'qwen']);
  });

  test('all providers normalize to a 1536-dim vector', () => {
    expect(VECTOR_SIZE).toBe(1536);
  });
});

describe('embedTexts guards', () => {
  test('returns an empty array without calling the API for empty input', async () => {
    expect(await embedTexts([], 'some-key')).toEqual([]);
  });

  test('throws when no api key is provided', async () => {
    await expect(embedTexts(['text'], '')).rejects.toThrow('API key required');
  });
});
