import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  fetchCalls,
  lastBody,
  mockFetch,
  resetFetchCalls,
  restoreFetch,
} from '../test/fetch-mock.js';
import { AnthropicProvider } from './anthropic.js';
import type { LLMMessage, LLMStreamEvent } from './provider.js';

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

beforeEach(resetFetchCalls);
afterEach(restoreFetch);

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
    // system goes into the top-level `system` field, as a cacheable block
    expect(body.system).toEqual([
      { type: 'text', text: 'be helpful', cache_control: { type: 'ephemeral' } },
    ]);
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

    const call = fetchCalls()[0];
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

  // The base URL is configurable, so the far side is not necessarily Anthropic.
  test('refuses a reply larger than any completion', async () => {
    const huge = `{"pad":"${'x'.repeat(2 * 1024 * 1024)}"}`;
    const provider = new AnthropicProvider('k', 'https://api.test', async () => new Response(huge));
    await expect(provider.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      'response too large',
    );
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

describe('prompt caching', () => {
  const done = () => new Response(sseStream([{ type: 'message_stop' }]));

  async function drain(it: AsyncIterable<LLMStreamEvent>): Promise<void> {
    for await (const _ of it) {
      // consume
    }
  }

  test('marks only the first system block, so a per-turn one after it cannot spoil the cache', async () => {
    mockFetch(done);
    await drain(
      new AnthropicProvider('k').stream([
        { role: 'system', content: 'stable instructions' },
        { role: 'system', content: 'memories for this turn' },
        { role: 'user', content: 'hi' },
      ]),
    );
    expect(lastBody().system).toEqual([
      { type: 'text', text: 'stable instructions', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'memories for this turn' },
    ]);
  });

  test("marks the conversation's last block, so later tool rounds reuse it", async () => {
    mockFetch(done);
    await drain(
      new AnthropicProvider('k').stream([
        { role: 'user', content: 'earlier' },
        { role: 'assistant', content: 'reply' },
        { role: 'tool', content: 'result', tool_call_id: 'call_1' },
      ]),
    );
    const sent = lastBody().messages as Array<{ content: unknown }>;
    expect(sent[0]?.content).toBe('earlier');
    expect(sent[1]?.content).toBe('reply');
    expect(sent[2]?.content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'call_1',
        content: 'result',
        cache_control: { type: 'ephemeral' },
      },
    ]);
  });

  test('turns a plain-text last message into a marked text block', async () => {
    mockFetch(done);
    await drain(new AnthropicProvider('k').stream([{ role: 'user', content: 'hi' }]));
    expect((lastBody().messages as Array<{ content: unknown }>)[0]?.content).toEqual([
      { type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } },
    ]);
  });

  test('leaves an empty last message alone, since an empty text block is rejected', async () => {
    mockFetch(done);
    await drain(new AnthropicProvider('k').stream([{ role: 'user', content: '' }]));
    expect((lastBody().messages as Array<{ content: unknown }>)[0]?.content).toBe('');
  });

  test('counts cache writes and reads into the prompt, and reports the reads', async () => {
    // input_tokens excludes both; reporting it alone would make a cached turn
    // look like it had a 30-token prompt.
    mockFetch(
      () =>
        new Response(
          sseStream([
            {
              type: 'message_start',
              message: {
                usage: {
                  input_tokens: 30,
                  cache_creation_input_tokens: 200,
                  cache_read_input_tokens: 1800,
                  output_tokens: 0,
                },
              },
            },
            { type: 'message_delta', delta: {}, usage: { output_tokens: 9 } },
            { type: 'message_stop' },
          ]),
        ),
    );
    const events: LLMStreamEvent[] = [];
    for await (const ev of new AnthropicProvider('k').stream([{ role: 'user', content: 'hi' }])) {
      events.push(ev);
    }
    expect(events.at(-1)).toEqual({
      type: 'done',
      usage: {
        prompt_tokens: 2030,
        completion_tokens: 9,
        cached_tokens: 1800,
        cache_write_tokens: 200,
      },
    });
  });

  test('reads null cache fields as unreported, not as a count', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'x' }],
            stop_reason: 'end_turn',
            usage: {
              input_tokens: 12,
              output_tokens: 3,
              cache_read_input_tokens: null,
              cache_creation_input_tokens: null,
            },
          }),
        ),
    );
    const res = await new AnthropicProvider('k').chat([{ role: 'user', content: 'hi' }]);
    expect(res.usage).toStrictEqual({ prompt_tokens: 12, completion_tokens: 3 });
  });

  test('sends a blank system prompt as nothing, since a blank text block is rejected', async () => {
    mockFetch(done);
    await drain(
      new AnthropicProvider('k').stream([
        { role: 'system', content: '   ' },
        { role: 'user', content: 'hi' },
      ]),
    );
    expect(lastBody().system).toBeUndefined();
  });
});

describe('stream token usage', () => {
  async function collect(it: AsyncIterable<LLMStreamEvent>): Promise<LLMStreamEvent[]> {
    const out: LLMStreamEvent[] = [];
    for await (const ev of it) out.push(ev);
    return out;
  }

  test('carries usage to the done event, taking input and output from different frames', async () => {
    // Anthropic splits it: input arrives on message_start before a single token
    // has been generated, output on message_delta at the end. Reading only one
    // of them reports half the cost.
    mockFetch(
      () =>
        new Response(
          sseStream([
            { type: 'message_start', message: { usage: { input_tokens: 1200, output_tokens: 0 } } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
            { type: 'message_delta', delta: {}, usage: { output_tokens: 42 } },
            { type: 'message_stop' },
          ]),
        ),
    );

    const events = await collect(
      new AnthropicProvider('k').stream([{ role: 'user', content: 'hi' }]),
    );
    expect(events.at(-1)).toEqual({
      type: 'done',
      usage: { prompt_tokens: 1200, completion_tokens: 42 },
    });
  });

  test('omits usage entirely when the stream reported none', async () => {
    // Absent is not zero. A `usage: {0, 0}` here would read as a free turn.
    mockFetch(
      () =>
        new Response(
          sseStream([
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
            { type: 'message_stop' },
          ]),
        ),
    );

    const events = await collect(
      new AnthropicProvider('k').stream([{ role: 'user', content: 'hi' }]),
    );
    expect(events.at(-1)).toEqual({ type: 'done' });
  });
});
