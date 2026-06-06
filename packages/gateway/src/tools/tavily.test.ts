import { afterEach, describe, expect, test } from 'bun:test';
import { tavilySearch, tavilyToolDefinition } from './tavily.js';

// Swap globalThis.fetch for the duration of one test, restoring after.
function stubFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  const real = globalThis.fetch;
  restore = () => {
    globalThis.fetch = real;
  };
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(impl(url, init));
  }) as typeof fetch;
}

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

describe('tavilySearch', () => {
  test('returns the not-configured message without calling the network when no api key', async () => {
    let called = false;
    stubFetch(() => {
      called = true;
      return Response.json({ results: [] });
    });
    const out = await tavilySearch('weather', '');
    expect(out).toContain('搜索功能未配置');
    expect(called).toBe(false);
  });

  test('formats the answer summary and each result', async () => {
    stubFetch((url, init) => {
      expect(url).toBe('https://api.tavily.com/search');
      const body = JSON.parse(String(init?.body)) as { api_key: string; query: string };
      expect(body.api_key).toBe('tvly-key');
      expect(body.query).toBe('A2A');
      return Response.json({
        answer: 'A2A is a protocol',
        results: [{ title: 'Spec', url: 'https://x.test', content: 'details', score: 1 }],
      });
    });
    const out = await tavilySearch('A2A', 'tvly-key');
    expect(out).toContain('摘要：A2A is a protocol');
    expect(out).toContain('[Spec](https://x.test)');
    expect(out).toContain('details');
  });

  test('omits the summary line when the response has no answer', async () => {
    stubFetch(() =>
      Response.json({
        results: [{ title: 'T', url: 'https://y.test', content: 'c', score: 0.5 }],
      }),
    );
    const out = await tavilySearch('q', 'k');
    expect(out).not.toContain('摘要');
    expect(out).toContain('[T](https://y.test)');
  });

  test('throws on a non-ok HTTP status', async () => {
    stubFetch(() => new Response('nope', { status: 500 }));
    await expect(tavilySearch('q', 'k')).rejects.toThrow('Tavily search failed: 500');
  });
});

describe('tavilyToolDefinition', () => {
  test('advertises the web_search tool with a required query', () => {
    expect(tavilyToolDefinition.name).toBe('web_search');
    expect(tavilyToolDefinition.parameters.required).toEqual(['query']);
  });
});
