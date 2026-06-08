import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AnthropicProvider } from './anthropic.js';
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

/** Build a ReadableStream of SSE `data: ` lines from JSON events. */
function sseStream(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n`));
      }
      controller.close();
    },
  });
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('toAnthropicMessages (via request body)', () => {
  test('filters out system messages from the messages array', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'hi' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        ),
    );
    const provider = new AnthropicProvider('key');
    const messages: LLMMessage[] = [
      { role: 'system', content: 'be helpful' },
      { role: 'user', content: 'hello' },
    ];
    await provider.chat(messages);
    const body = lastBody();
    const sent = body.messages as Array<{ role: string }>;
    expect(sent).toHaveLength(1);
    expect(sent[0]?.role).toBe('user');
    // system goes into the top-level `system` field
    expect(body.system).toBe('be helpful');
  });

  test('maps a tool role message to user with tool_result content', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 0, output_tokens: 0 },
          }),
        ),
    );
    const provider = new AnthropicProvider('key');
    const messages: LLMMessage[] = [
      { role: 'tool', content: 'result-data', tool_call_id: 'call_1' },
    ];
    await provider.chat(messages);
    const sent = lastBody().messages as Array<{ role: string; content: unknown }>;
    expect(sent[0]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'result-data' }],
    });
  });

  test('maps assistant tool_calls to assistant with tool_use blocks', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 0, output_tokens: 0 },
          }),
        ),
    );
    const provider = new AnthropicProvider('key');
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: 'let me check',
        tool_calls: [
          {
            id: 'call_42',
            type: 'function',
            function: { name: 'lookup', arguments: '{"q":"x"}' },
          },
        ],
      },
    ];
    await provider.chat(messages);
    const sent = lastBody().messages as Array<{ role: string; content: unknown[] }>;
    expect(sent[0]?.role).toBe('assistant');
    expect(sent[0]?.content).toEqual([
      { type: 'text', text: 'let me check' },
      { type: 'tool_use', id: 'call_42', name: 'lookup', input: { q: 'x' } },
    ]);
  });
});

describe('chat', () => {
  test('builds the correct request (model, max_tokens, headers)', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'response' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 5, output_tokens: 7 },
          }),
        ),
    );
    const provider = new AnthropicProvider('secret-key', 'https://example.test');
    const res = await provider.chat([{ role: 'user', content: 'hi' }], {
      model: 'claude-3',
      max_tokens: 100,
      temperature: 0.5,
    });

    const call = calls[0];
    expect(call?.url).toBe('https://example.test/v1/messages');
    const headers = call?.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('secret-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = lastBody();
    expect(body.model).toBe('claude-3');
    expect(body.max_tokens).toBe(100);
    expect(body.temperature).toBe(0.5);

    expect(res.content).toBe('response');
    expect(res.usage).toEqual({ prompt_tokens: 5, completion_tokens: 7 });
  });

  test('maps stop_reason max_tokens -> length', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'x' }],
            stop_reason: 'max_tokens',
            usage: { input_tokens: 0, output_tokens: 0 },
          }),
        ),
    );
    const res = await new AnthropicProvider('k').chat([{ role: 'user', content: 'hi' }]);
    expect(res.finish_reason).toBe('length');
  });

  test('maps stop_reason tool_use -> tool_use', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'x' }],
            stop_reason: 'tool_use',
            usage: { input_tokens: 0, output_tokens: 0 },
          }),
        ),
    );
    const res = await new AnthropicProvider('k').chat([{ role: 'user', content: 'hi' }]);
    expect(res.finish_reason).toBe('tool_use');
  });

  test('maps any other stop_reason -> stop', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'x' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 0, output_tokens: 0 },
          }),
        ),
    );
    const res = await new AnthropicProvider('k').chat([{ role: 'user', content: 'hi' }]);
    expect(res.finish_reason).toBe('stop');
  });

  test('throws on a non-ok response', async () => {
    mockFetch(() => new Response('boom', { status: 500 }));
    await expect(
      new AnthropicProvider('k').chat([{ role: 'user', content: 'hi' }]),
    ).rejects.toThrow(/Anthropic API error \(500\)/);
  });
});

describe('stream', () => {
  async function collect(it: AsyncIterable<LLMStreamEvent>): Promise<LLMStreamEvent[]> {
    const out: LLMStreamEvent[] = [];
    for await (const ev of it) out.push(ev);
    return out;
  }

  test('parses chunked text deltas and emits token + done', async () => {
    mockFetch(
      () =>
        new Response(
          sseStream([
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } },
            { type: 'message_stop' },
          ]),
        ),
    );
    const events = await collect(
      new AnthropicProvider('k').stream([{ role: 'user', content: 'hi' }]),
    );
    expect(events).toEqual([
      { type: 'token', text: 'Hel' },
      { type: 'token', text: 'lo' },
      { type: 'done' },
    ]);
  });

  test('accumulates tool_use input json across deltas and emits a tool_call', async () => {
    mockFetch(
      () =>
        new Response(
          sseStream([
            {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'tool_use', id: 'tc_1', name: 'search' },
            },
            {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'input_json_delta', partial_json: '{"q":' },
            },
            {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'input_json_delta', partial_json: '"hi"}' },
            },
            { type: 'message_stop' },
          ]),
        ),
    );
    const events = await collect(
      new AnthropicProvider('k').stream([{ role: 'user', content: 'hi' }]),
    );
    expect(events).toEqual([
      { type: 'tool_call', tool_call: { id: 'tc_1', name: 'search', arguments: '{"q":"hi"}' } },
      { type: 'done' },
    ]);
  });

  test('throws on a non-ok stream response', async () => {
    mockFetch(() => new Response('nope', { status: 429 }));
    const it = new AnthropicProvider('k').stream([{ role: 'user', content: 'hi' }]);
    await expect(collect(it)).rejects.toThrow(/Anthropic stream error: 429/);
  });
});
