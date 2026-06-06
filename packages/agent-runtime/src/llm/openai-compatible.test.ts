import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  OpenAICompatibleProvider,
  createDeepSeekProvider,
  createGlmProvider,
  createOllamaProvider,
  createOpenAICompatibleProvider,
  createOpenAIProvider,
  createQwenProvider,
} from './openai-compatible.js';
import type { LLMMessage, LLMStreamEvent } from './provider.js';

const realFetch = globalThis.fetch;

type FetchCall = { url: string; init: RequestInit };
let calls: FetchCall[] = [];

function mockFetch(impl: (url: string, init: RequestInit) => Response): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const finalInit = init ?? {};
    calls.push({ url, init: finalInit });
    return impl(url, finalInit);
  }) as typeof fetch;
}

function lastBody(): Record<string, unknown> {
  const call = calls[calls.length - 1];
  if (!call) throw new Error('no fetch call recorded');
  return JSON.parse(call.init.body as string) as Record<string, unknown>;
}

function chatResponse(opts: {
  content?: string;
  finish_reason?: string;
}): Response {
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

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

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

describe('named factories', () => {
  test('createDeepSeekProvider', () => {
    const p = createDeepSeekProvider('k');
    expect(p.name).toBe('deepseek');
    expect((p as unknown as { baseUrl: string }).baseUrl).toBe('https://api.deepseek.com');
    expect((p as unknown as { defaultModel: string }).defaultModel).toBe('deepseek-chat');
  });

  test('createOpenAIProvider', () => {
    const p = createOpenAIProvider('k');
    expect(p.name).toBe('openai');
    expect((p as unknown as { baseUrl: string }).baseUrl).toBe('https://api.openai.com');
    expect((p as unknown as { defaultModel: string }).defaultModel).toBe('gpt-4o');
  });

  test('createQwenProvider', () => {
    const p = createQwenProvider('k');
    expect(p.name).toBe('qwen');
    expect((p as unknown as { baseUrl: string }).baseUrl).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode',
    );
    expect((p as unknown as { defaultModel: string }).defaultModel).toBe('qwen-plus');
  });

  test('createGlmProvider uses /chat/completions path', () => {
    const p = createGlmProvider('k');
    expect(p.name).toBe('glm');
    expect((p as unknown as { baseUrl: string }).baseUrl).toBe(
      'https://open.bigmodel.cn/api/paas/v4',
    );
    expect((p as unknown as { defaultModel: string }).defaultModel).toBe('glm-4-flash');
    expect((p as unknown as { completionsPath: string }).completionsPath).toBe('/chat/completions');
  });

  test('createOllamaProvider defaults to localhost', () => {
    const p = createOllamaProvider();
    expect(p.name).toBe('ollama');
    expect((p as unknown as { baseUrl: string }).baseUrl).toBe('http://localhost:11434');
    expect((p as unknown as { defaultModel: string }).defaultModel).toBe('llama3');
  });

  test('createOpenAICompatibleProvider applies defaults and overrides', () => {
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
