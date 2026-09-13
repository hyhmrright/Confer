import { afterEach, describe, expect, test } from 'bun:test';
import { EMBEDDING_PROVIDER_PRIORITY, embedTexts, VECTOR_SIZE } from './embedding.js';

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
  // A local runtime is dialled at the address its check saw (runtimeFetcher),
  // over node:http rather than the global fetch — so these need a listener, not
  // a fetch stub.
  let server: ReturnType<typeof Bun.serve> | undefined;
  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  function localRuntime(respond: () => Response): {
    base: string;
    calls: Array<{ path: string; authorization: string | null; body: string }>;
  } {
    const calls: Array<{ path: string; authorization: string | null; body: string }> = [];
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(req) {
        calls.push({
          path: new URL(req.url).pathname,
          authorization: req.headers.get('authorization'),
          body: await req.text(),
        });
        return respond();
      },
    });
    return { base: `http://127.0.0.1:${server.port}`, calls };
  }

  // Answer with `dimensions` values, so a test can see what we do with a reply
  // narrower than VECTOR_SIZE.
  function vectorOf(dimensions: number): Response {
    const embedding = Array.from({ length: dimensions }, (_, i) => (i === 0 ? 1 : 0));
    return Response.json({ data: [{ embedding, index: 0 }] });
  }

  // Ollama has no API key: the settings UI reuses that slot for the base URL,
  // exactly as the chat provider does.
  test('treats the key as a base URL and sends no Authorization header', async () => {
    const { base, calls } = localRuntime(() => vectorOf(VECTOR_SIZE));

    await embedTexts(['text'], `${base}/`, 'ollama');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/v1/embeddings');
    expect(calls[0]?.authorization).toBeNull();
    expect(JSON.parse(calls[0]?.body ?? '{}').model).toBe('nomic-embed-text');
  });

  // nomic-embed-text is 768-dim and ignores the requested `dimensions`, while
  // the Qdrant collection is fixed at VECTOR_SIZE. Zero-padding reconciles them
  // without changing cosine similarity.
  test('zero-pads a short vector up to VECTOR_SIZE', async () => {
    const { base } = localRuntime(() => vectorOf(768));

    const [vector] = await embedTexts(['text'], base, 'ollama');

    expect(vector).toHaveLength(VECTOR_SIZE);
    expect(vector?.[0]).toBe(1);
    expect(vector?.slice(768).every((v) => v === 0)).toBe(true);
  });

  // Checked when dialled, not only when saved: a value stored before the
  // query rule existed, or a name re-pointed after saving, stops here.
  test('refuses an address that fails the dial-time check', async () => {
    for (const base of [
      'http://qdrant:6333/collections/x/snapshots?',
      'http://169.254.169.254',
      'http://100.100.100.200',
    ]) {
      await expect(embedTexts(['text'], base, 'ollama')).rejects.toThrow();
    }
  });

  // The message reaches the owner's browser as a tool result, and a local
  // runtime's far side can be one of this gateway's own internal services.
  test('reports a failed call by status, never by the response body', async () => {
    const { base } = localRuntime(() => new Response('internal detail', { status: 400 }));

    const error = await embedTexts(['text'], base, 'ollama').catch((e: Error) => e);

    expect(String(error)).toContain('(400)');
    expect(String(error)).not.toContain('internal detail');
  });
});
