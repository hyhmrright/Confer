import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type { LLMMessage, LLMProvider, LLMResponse, LLMStreamEvent } from '@confer/agent-runtime';
import { narrowKbIds, runAgentTurn } from './agent-orchestrator.js';

// A provider that replays scripted stream events per round, so a turn can be
// driven through the tool loop without any network or model.
function scriptedProvider(rounds: LLMStreamEvent[][]): LLMProvider {
  let round = 0;
  return {
    name: 'scripted',
    async chat(_m: LLMMessage[]): Promise<LLMResponse> {
      throw new Error('not used');
    },
    async *stream(): AsyncGenerator<LLMStreamEvent> {
      for (const event of rounds[round] ?? [{ type: 'token', text: '' }]) yield event;
      round++;
    },
  };
}

function token(text: string): LLMStreamEvent {
  return { type: 'token', text };
}

function toolCall(name: string, args = '{"query":"x"}'): LLMStreamEvent {
  return { type: 'tool_call', tool_call: { id: 'call_1', name, arguments: args } };
}

// Base options for a turn with everything off: no embedding key (recall
// disabled), no Tavily key, no knowledge base. Each test switches on only the
// capability it is about.
const baseOpts = {
  systemPromptBase: 'You are a test agent.',
  history: [],
  userMessage: '你好',
  userId: '01HTURNUSER0000000000000AA',
  embeddingKey: '',
  embeddingProvider: 'openai' as const,
  tavilyApiKey: '',
  hasKb: false,
  recallMemory: true,
};

// Capture the grounding line without letting it reach the real console. Scoped
// to this file: bun runs every test file in one process, so an override left
// standing would silently swallow the log output of all the others.
const logged: string[] = [];
const realLog = console.log;

beforeAll(() => {
  console.log = (...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  };
});
afterAll(() => {
  console.log = realLog;
});
afterEach(() => {
  logged.length = 0;
});

function groundingLine(): string {
  return logged.find((l) => l.startsWith('agent turn ')) ?? '';
}

// The scope is decided from the owner's configuration; this is the point where
// it is enforced against what the model asked for. It matters more than it
// looks: `kb_ids` is absent from the tool schema but the model can put it in
// the arguments regardless, and `searchChunks` reads an absent list as "search
// everything" — so both "the model named a base it may not read" and "nothing
// survived the intersection" have to land somewhere closed.
describe('narrowKbIds', () => {
  test('leaves an unscoped turn exactly as the model asked', () => {
    expect(narrowKbIds(undefined, undefined)).toBeUndefined();
    expect(narrowKbIds(['kb1'], undefined)).toEqual(['kb1']);
  });

  test('falls back to the whole scope when the model names nothing', () => {
    expect(narrowKbIds(undefined, ['kb1', 'kb2'])).toEqual(['kb1', 'kb2']);
  });

  test('keeps only the ids inside the scope', () => {
    expect(narrowKbIds(['kb1', 'secret'], ['kb1', 'kb2'])).toEqual(['kb1']);
  });

  test('never yields undefined when the model names only forbidden bases', () => {
    const out = narrowKbIds(['secret'], ['kb1']);
    expect(out).not.toBeUndefined();
    expect(out).not.toEqual(['kb1']);
    expect(out).toHaveLength(1);
  });

  test('never yields undefined when the scope itself is empty', () => {
    expect(narrowKbIds(undefined, [])).not.toBeUndefined();
    expect(narrowKbIds(['kb1'], [])).not.toBeUndefined();
  });
});

describe('runAgentTurn grounding', () => {
  test('reports recall off and no knowledge base when the owner has neither', async () => {
    const result = await runAgentTurn({
      ...baseOpts,
      provider: scriptedProvider([[token('答案')]]),
    });

    expect(result.content).toBe('答案');
    expect(groundingLine()).toBe(
      `agent turn user=${baseOpts.userId} recall=off kb=none cites=0 tools=0`,
    );
  });

  // The instruction in the system prompt *mandates* a knowledge-base search
  // before answering. A model that ignores it returns fluent prose from its own
  // priors that is indistinguishable, in the reply, from a grounded answer —
  // this line is the only place that difference is visible.
  test('reports an unsearched knowledge base when the model answers without calling the tool', async () => {
    await runAgentTurn({
      ...baseOpts,
      hasKb: true,
      provider: scriptedProvider([[token('我记得是这样的')]]),
    });

    expect(groundingLine()).toContain('kb=unsearched');
    expect(groundingLine()).toContain('cites=0');
  });

  test('reports a searched knowledge base once the model calls the tool', async () => {
    await runAgentTurn({
      ...baseOpts,
      hasKb: true,
      // Round 1 asks for the tool; round 2 answers with the result in hand.
      provider: scriptedProvider([[toolCall('search_knowledge_base')], [token('根据文档…')]]),
    });

    expect(groundingLine()).toContain('kb=searched');
    expect(groundingLine()).toContain('tools=1');
  });

  test('reports memory as withheld, not off, when the audience is a peer', async () => {
    await runAgentTurn({
      ...baseOpts,
      embeddingKey: 'sk-present',
      recallMemory: false,
      provider: scriptedProvider([[token('答案')]]),
    });

    // `off` would read as "this owner has no embedding key" — a
    // misconfiguration to go fix, rather than the boundary doing its job.
    expect(groundingLine()).toContain('recall=withheld');
  });

  test('never puts the message or its reply in the log line', async () => {
    await runAgentTurn({
      ...baseOpts,
      userMessage: '我的身份证号是 110101',
      provider: scriptedProvider([[token('好的，记住了 110101')]]),
    });

    expect(groundingLine()).not.toContain('110101');
    expect(groundingLine()).not.toContain('身份证');
  });
});
