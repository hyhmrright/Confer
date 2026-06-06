import { describe, expect, test } from 'bun:test';
import type {
  LLMChatOptions,
  LLMMessage,
  LLMProvider,
  LLMResponse,
  LLMStreamEvent,
} from '../llm/provider.js';
import { type AgentContext, runAgentLoop, streamAgentLoop } from './agent-loop.js';

/** A fake provider that records the messages it receives and replays canned output. */
class FakeProvider implements LLMProvider {
  readonly name = 'fake';
  lastMessages: LLMMessage[] | null = null;

  constructor(
    private readonly response: LLMResponse,
    private readonly streamEvents: LLMStreamEvent[] = [],
  ) {}

  async chat(messages: LLMMessage[], _options?: LLMChatOptions): Promise<LLMResponse> {
    this.lastMessages = messages;
    return this.response;
  }

  async *stream(messages: LLMMessage[], _options?: LLMChatOptions): AsyncIterable<LLMStreamEvent> {
    this.lastMessages = messages;
    for (const ev of this.streamEvents) yield ev;
  }
}

function makeContext(provider: LLMProvider, history: LLMMessage[] = []): AgentContext {
  return {
    agentId: 'agent_1',
    userId: 'user_1',
    provider,
    systemPrompt: 'you are helpful',
    conversationHistory: history,
  };
}

describe('runAgentLoop', () => {
  test('returns the provider response content', async () => {
    const provider = new FakeProvider({
      content: 'hello there',
      finish_reason: 'stop',
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    });
    const result = await runAgentLoop(makeContext(provider), 'hi');
    expect(result).toBe('hello there');
  });

  test('assembles messages with system first, history preserved, user last', async () => {
    const provider = new FakeProvider({
      content: 'ok',
      finish_reason: 'stop',
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    });
    const history: LLMMessage[] = [
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
    ];
    await runAgentLoop(makeContext(provider, history), 'new question');

    expect(provider.lastMessages).toEqual([
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
      { role: 'user', content: 'new question' },
    ]);
  });
});

describe('streamAgentLoop', () => {
  test('yields the provider stream events in order', async () => {
    const events: LLMStreamEvent[] = [
      { type: 'token', text: 'a' },
      { type: 'token', text: 'b' },
      { type: 'done' },
    ];
    const provider = new FakeProvider(
      { content: '', finish_reason: 'stop', usage: { prompt_tokens: 0, completion_tokens: 0 } },
      events,
    );
    const out: LLMStreamEvent[] = [];
    for await (const ev of streamAgentLoop(makeContext(provider), 'hi')) out.push(ev);
    expect(out).toEqual(events);
  });

  test('passes the assembled messages (system first) to the provider stream', async () => {
    const provider = new FakeProvider(
      { content: '', finish_reason: 'stop', usage: { prompt_tokens: 0, completion_tokens: 0 } },
      [{ type: 'done' }],
    );
    const history: LLMMessage[] = [{ role: 'user', content: 'h1' }];
    for await (const _ of streamAgentLoop(makeContext(provider, history), 'q')) {
      // drain
    }
    expect(provider.lastMessages).toEqual([
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'h1' },
      { role: 'user', content: 'q' },
    ]);
  });
});
