import { afterEach, describe, expect, mock, test } from 'bun:test';
import { EMBEDDING_PROVIDER_PRIORITY, embedTexts, VECTOR_SIZE } from './embedding.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// Capture the one outbound embeddings call and answer it with `dimensions`
// values, so a test can assert both what we sent and what we do with a reply
// that is narrower than VECTOR_SIZE.
function stubEmbeddings(dimensions: number): { calls: Array<[string, RequestInit]> } {
  const calls: Array<[string, RequestInit]> = [];
  globalThis.fetch = mock(async (url: string, init: RequestInit) => {
    calls.push([String(url), init]);
    const embedding = Array.from({ length: dimensions }, (_, i) => (i === 0 ? 1 : 0));
    return Response.json({ data: [{ embedding, index: 0 }] });
  }) as unknown as typeof fetch;
  return { calls };
}

describe('embedding contracts', () => {
  test('auto-select priority is openai -> glm -> qwen -> ollama', () => {
    // Contract: first provider with a user-configured key wins, in this order.
    // Ollama is last so a local chat model never displaces a hosted key.
    expect(EMBEDDING_PROVIDER_PRIORITY).toEqual(['openai', 'glm', 'qwen', 'ollama']);
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

describe('ollama (local) provider', () => {
  // Ollama has no API key: the settings UI reuses that slot for the base URL,
  // exactly as the chat provider does.
  test('treats the key as a base URL and sends no Authorization header', async () => {
    const { calls } = stubEmbeddings(VECTOR_SIZE);

    await embedTexts(['text'], 'http://host.docker.internal:11434/', 'ollama');

    const [url, init] = calls[0] ?? [];
    expect(url).toBe('http://host.docker.internal:11434/v1/embeddings');
    expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
    expect(JSON.parse(String(init?.body)).model).toBe('nomic-embed-text');
  });

  // nomic-embed-text is 768-dim and ignores the requested `dimensions`, while
  // the Qdrant collection is fixed at VECTOR_SIZE. Zero-padding reconciles them
  // without changing cosine similarity.
  test('zero-pads a short vector up to VECTOR_SIZE', async () => {
    stubEmbeddings(768);

    const [vector] = await embedTexts(['text'], 'http://localhost:11434', 'ollama');

    expect(vector).toHaveLength(VECTOR_SIZE);
    expect(vector?.[0]).toBe(1);
    expect(vector?.slice(768).every((v) => v === 0)).toBe(true);
  });
});
