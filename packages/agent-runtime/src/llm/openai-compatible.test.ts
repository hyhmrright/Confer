import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { lastBody, mockFetch, resetFetchCalls, restoreFetch } from '../test/fetch-mock.js';
import { createOpenAICompatibleProvider, OpenAICompatibleProvider } from './openai-compatible.js';
import type { LLMMessage, LLMStreamEvent } from './provider.js';

function chatResponse(opts: { content?: string; finish_reason?: string }): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: { content: opts.content ?? 'ok', role: 'assistant' },
          finish_reason: opts.finish_reason ?? 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2 },
    }),
  );
}

function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const l of lines) {
        controller.enqueue(encoder.encode(`${l}\n`));
      }
      controller.close();
    },
  });
}

function dataLine(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}`;
}

beforeEach(resetFetchCalls);
afterEach(restoreFetch);

describe('toOpenAIMessage (via request body)', () => {
  const provider = () => new OpenAICompatibleProvider('test', 'k', 'https://api.test', 'm');

  test('maps a tool role message to { role: tool, tool_call_id }', async () => {
    mockFetch(() => chatResponse({}));
    const messages: LLMMessage[] = [{ role: 'tool', content: 'res', tool_call_id: 'c1' }];
    await provider().chat(messages);
    const sent = lastBody().messages as Array<Record<string, unknown>>;
    expect(sent[0]).toEqual({ role: 'tool', content: 'res', tool_call_id: 'c1' });
  });

  test('maps assistant tool_calls passthrough', async () => {
    mockFetch(() => chatResponse({}));
    const toolCalls = [
      { id: 'c1', type: 'function' as const, function: { name: 'f', arguments: '{}' } },
    ];
    const messages: LLMMessage[] = [
      { role: 'assistant', content: 'hold on', tool_calls: toolCalls },
    ];
    await provider().chat(messages);
    const sent = lastBody().messages as Array<Record<string, unknown>>;
    expect(sent[0]).toEqual({ role: 'assistant', content: 'hold on', tool_calls: toolCalls });
  });

  test('maps a plain message preserving role and content', async () => {
    mockFetch(() => chatResponse({}));
    await provider().chat([{ role: 'user', content: 'hi' }]);
    const sent = lastBody().messages as Array<Record<string, unknown>>;
    expect(sent[0]).toEqual({ role: 'user', content: 'hi' });
  });
});

describe('chat finish_reason mapping', () => {
  const provider = () => new OpenAICompatibleProvider('test', 'k', 'https://api.test', 'm');

  test('tool_calls -> tool_use', async () => {
    mockFetch(() => chatResponse({ finish_reason: 'tool_calls' }));
    const res = await provider().chat([{ role: 'user', content: 'hi' }]);
    expect(res.finish_reason).toBe('tool_use');
  });

  test('length -> length', async () => {
    mockFetch(() => chatResponse({ finish_reason: 'length' }));
    const res = await provider().chat([{ role: 'user', content: 'hi' }]);
    expect(res.finish_reason).toBe('length');
  });

  test('anything else -> stop', async () => {
    mockFetch(() => chatResponse({ finish_reason: 'content_filter' }));
    const res = await provider().chat([{ role: 'user', content: 'hi' }]);
    expect(res.finish_reason).toBe('stop');
  });

  test('throws when no choices are returned', async () => {
    mockFetch(() => new Response(JSON.stringify({ choices: [], usage: {} })));
    await expect(provider().chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /returned no choices/,
    );
  });
});

// The per-vendor factories that used to live here are gone: base URLs, paths
// and default models now come from the shared catalogue, and `createProvider`
// in registry.test.ts covers reading them. Only the escape hatch for an
// uncatalogued endpoint is still this file's to test.
describe('createOpenAICompatibleProvider', () => {
  test('applies defaults and overrides', () => {
    const def = createOpenAICompatibleProvider('custom', 'k');
    expect(def.name).toBe('custom');
    expect((def as unknown as { baseUrl: string }).baseUrl).toBe('https://api.openai.com');
    expect((def as unknown as { defaultModel: string }).defaultModel).toBe('gpt-4o');
    expect((def as unknown as { completionsPath: string }).completionsPath).toBe(
      '/v1/chat/completions',
    );

    const custom = createOpenAICompatibleProvider('custom', 'k', {
      baseUrl: 'https://x.test',
      model: 'mymodel',
      completionsPath: '/chat',
    });
    expect((custom as unknown as { baseUrl: string }).baseUrl).toBe('https://x.test');
    expect((custom as unknown as { defaultModel: string }).defaultModel).toBe('mymodel');
    expect((custom as unknown as { completionsPath: string }).completionsPath).toBe('/chat');
  });
});

describe('stream', () => {
  async function collect(it: AsyncIterable<LLMStreamEvent>): Promise<LLMStreamEvent[]> {
    const out: LLMStreamEvent[] = [];
    for await (const ev of it) out.push(ev);
    return out;
  }

  const provider = () => new OpenAICompatibleProvider('test', 'k', 'https://api.test', 'm');

  test('emits token events for content deltas then done on [DONE]', async () => {
    mockFetch(
      () =>
        new Response(
          sseStream([
            dataLine({ choices: [{ delta: { content: 'Hel' } }] }),
            dataLine({ choices: [{ delta: { content: 'lo' } }] }),
            'data: [DONE]',
          ]),
        ),
    );
    const events = await collect(provider().stream([{ role: 'user', content: 'hi' }]));
    expect(events).toEqual([
      { type: 'token', text: 'Hel' },
      { type: 'token', text: 'lo' },
      { type: 'done' },
    ]);
  });

  test('accumulates pending tool calls across deltas and emits on [DONE]', async () => {
    mockFetch(
      () =>
        new Response(
          sseStream([
            dataLine({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":' } },
                    ],
                  },
                },
              ],
            }),
            dataLine({
              choices: [
                { delta: { tool_calls: [{ index: 0, function: { arguments: '"hi"}' } }] } },
              ],
            }),
            'data: [DONE]',
          ]),
        ),
    );
    const events = await collect(provider().stream([{ role: 'user', content: 'hi' }]));
    expect(events).toEqual([
      { type: 'tool_call', tool_call: { id: 'call_1', name: 'search', arguments: '{"q":"hi"}' } },
      { type: 'done' },
    ]);
  });

  test('throws on a non-ok stream response', async () => {
    mockFetch(() => new Response('nope', { status: 500 }));
    const it = provider().stream([{ role: 'user', content: 'hi' }]);
    await expect(collect(it)).rejects.toThrow(/test stream error: 500/);
  });
});

describe('stream token usage', () => {
  async function collect(it: AsyncIterable<LLMStreamEvent>): Promise<LLMStreamEvent[]> {
    const out: LLMStreamEvent[] = [];
    for await (const ev of it) out.push(ev);
    return out;
  }

  test('reads usage from the final chunk and carries it to done', async () => {
    mockFetch(
      () =>
        new Response(
          sseStream([
            dataLine({ choices: [{ delta: { content: 'ok' } }] }),
            // The usage chunk: an EMPTY choices array, which is why indexing
            // into it has to be guarded.
            dataLine({ choices: [], usage: { prompt_tokens: 900, completion_tokens: 31 } }),
            'data: [DONE]',
          ]),
        ),
    );

    const events = await collect(
      new OpenAICompatibleProvider('test', 'k', 'https://api.test', 'm').stream([
        { role: 'user', content: 'hi' },
      ]),
    );

    expect(events.at(-1)).toEqual({
      type: 'done',
      usage: { prompt_tokens: 900, completion_tokens: 31 },
    });
  });

  test('survives a usage chunk that omits choices entirely', async () => {
    // Some vendors send `{usage: …}` with no `choices` key at all. Reading
    // `data.choices[0]` unguarded threw here, losing an answer already streamed
    // in full to the reader.
    mockFetch(
      () =>
        new Response(
          sseStream([
            dataLine({ choices: [{ delta: { content: 'ok' } }] }),
            dataLine({ usage: { prompt_tokens: 5, completion_tokens: 6 } }),
            'data: [DONE]',
          ]),
        ),
    );

    const events = await collect(
      new OpenAICompatibleProvider('test', 'k', 'https://api.test', 'm').stream([
        { role: 'user', content: 'hi' },
      ]),
    );

    expect(events).toContainEqual({ type: 'token', text: 'ok' });
    expect(events.at(-1)).toEqual({
      type: 'done',
      usage: { prompt_tokens: 5, completion_tokens: 6 },
    });
  });

  test('never asks for usage, so a vendor that rejects unknown fields still works', async () => {
    // `stream_options: {include_usage: true}` is what OpenAI wants, and a 400
    // at any of the other seventeen catalogue entries. Which ones accept it is
    // precisely the sort of per-vendor claim this codebase has been wrong about
    // before, so it is never sent.
    mockFetch(
      () => new Response(sseStream([dataLine({ choices: [{ delta: {} }] }), 'data: [DONE]'])),
    );
    await collect(
      new OpenAICompatibleProvider('test', 'k', 'https://api.test', 'm').stream([
        { role: 'user', content: 'hi' },
      ]),
    );

    expect(lastBody()).not.toHaveProperty('stream_options');
  });

  test('omits usage when the vendor reported none', async () => {
    mockFetch(
      () =>
        new Response(
          sseStream([dataLine({ choices: [{ delta: { content: 'ok' } }] }), 'data: [DONE]']),
        ),
    );

    const events = await collect(
      new OpenAICompatibleProvider('test', 'k', 'https://api.test', 'm').stream([
        { role: 'user', content: 'hi' },
      ]),
    );
    expect(events.at(-1)).toEqual({ type: 'done' });
  });
});
