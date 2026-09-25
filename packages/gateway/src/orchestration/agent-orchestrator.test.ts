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
  audience: 'owner' as const,
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
    const line = groundingLine();
    expect(line).toContain(`user=${baseOpts.userId}`);
    expect(line).toContain('recall=off');
    expect(line).toContain('kb=none');
    expect(line).toContain('cites=0');
    expect(line).toContain('tools=0');
  });

  test('records what the turn cost beside what it was grounded in', async () => {
    // One line, not two. A turn's cost and its grounding are read together —
    // "this answer was expensive AND ungrounded" is the interesting case, and
    // splitting them across two log lines is what makes it hard to see.
    await runAgentTurn({
      ...baseOpts,
      provider: scriptedProvider([[toolCall('search_knowledge_base')], [token('根据文档…')]]),
      hasKb: true,
    });

    const line = groundingLine();
    expect(line).toContain('gen_ai.provider.name=scripted');
    expect(line).toContain('rounds=2');
    expect(line).toMatch(/duration_ms=\d+/);
  });

  test('records a turn that threw, then rethrows it', async () => {
    // A turn that fails after two tool rounds has still been paid for, and it is
    // the one an owner most wants to find afterwards.
    const boom = {
      name: 'scripted',
      chat: () => Promise.reject(new Error('unused')),
      // biome-ignore lint/correctness/useYield: the throw is the whole point.
      async *stream(): AsyncIterable<never> {
        throw new TypeError('provider exploded');
      },
    };

    await expect(runAgentTurn({ ...baseOpts, provider: boom })).rejects.toThrow(
      'provider exploded',
    );
    expect(groundingLine()).toContain('error.type=TypeError');
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
      audience: 'owner' as const,
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

// The security property that "we simply don't offer the tool" does not give
// you. A model can emit a call for a name it was never handed — a peer's
// question and the owner's instructions arrive as the same kind of text, so
// being talked into it is exactly the scenario — and `executeToolCall` receives
// the name and arguments regardless of what the schema advertised. So the
// audience is re-checked where the call would actually run.
//
// These assertions also double as a canary: if the check were removed, the tool
// would reach getDb() and the failure would be a database error rather than a
// quiet leak, which is the right way round.
describe('owner-only tools on a peer turn', () => {
  const peerOpts = { ...baseOpts, audience: 'peer' as const, recallMemory: false };

  async function callAsPeer(name: string): Promise<string> {
    const results: string[] = [];
    await runAgentTurn({
      ...peerOpts,
      provider: scriptedProvider([[toolCall(name)], [token('ok')]]),
      emit: {
        onToolResult: (result) => {
          results.push(result);
        },
      },
    });
    return results[0] ?? '';
  }

  test('refuses search_memory', async () => {
    // Long-term memory is distilled from the owner's own chats and nothing in
    // it is marked fit to leave the instance.
    expect(await callAsPeer('search_memory')).toContain('未知工具');
  });

  test('refuses list_contacts', async () => {
    // A contact list is the owner's social graph; answering a stranger's
    // question never requires telling them who else the owner talks to.
    expect(await callAsPeer('list_contacts')).toContain('未知工具');
  });

  test('still answers the turn rather than aborting it', async () => {
    // A refused tool is handed back to the model as text, like any other tool
    // result — the turn continues and the peer gets an answer.
    const provider = scriptedProvider([[toolCall('list_contacts')], [token('已回答')]]);
    const turn = await runAgentTurn({ ...peerOpts, provider });
    expect(turn.content).toBe('已回答');
  });
});

describe('several tool calls in one round', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  // Counts searches in flight rather than timing the round: a peak above one is
  // proof they overlapped, where a wall-clock bound is a race on a slow runner.
  // A query named `slow…` answers later than the rest, so the one asked first
  // finishes last, and a result list built in completion order comes back
  // reversed.
  let inFlight = 0;
  let peak = 0;
  function countingTavily(): void {
    inFlight = 0;
    peak = 0;
    globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
      const { query } = JSON.parse(init?.body ?? '{}') as { query: string };
      peak = Math.max(peak, ++inFlight);
      await Bun.sleep(query.startsWith('slow') ? 30 : 10);
      inFlight--;
      return Response.json({ results: [], answer: query });
    }) as unknown as typeof fetch;
  }

  function search(id: string, query: string): LLMStreamEvent {
    return {
      type: 'tool_call',
      tool_call: { id, name: 'web_search', arguments: JSON.stringify({ query }) },
    };
  }

  // One round asking for these searches, then a plain answer; returns what the
  // second round was sent and the results as the stream reported them.
  async function runRound(queries: string[]) {
    let secondRound: LLMMessage[] = [];
    let round = 0;
    const provider: LLMProvider = {
      name: 'scripted',
      async chat(): Promise<LLMResponse> {
        throw new Error('not used');
      },
      async *stream(messages): AsyncGenerator<LLMStreamEvent> {
        if (round++ === 0) {
          for (const q of queries) yield search(`call_${q}`, q);
        } else {
          secondRound = messages;
          yield token('done');
        }
      },
    };
    const results: string[] = [];
    await runAgentTurn({
      ...baseOpts,
      tavilyApiKey: 'test-key',
      provider,
      emit: { onToolResult: (r) => void results.push(r) },
    });
    return { secondRound, results };
  }

  test('run together, and come back in the order the model asked for them', async () => {
    countingTavily();
    const { secondRound, results } = await runRound(['slow', 'fast']);

    expect(peak).toBe(2);
    expect(results).toEqual(['摘要：slow', '摘要：fast']);
    expect(secondRound.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual([
      'call_slow',
      'call_fast',
    ]);
  });

  test('never run more than four at once, however many the model asks for', async () => {
    countingTavily();
    const queries = ['slow1', 'q2', 'q3', 'q4', 'q5', 'q6'];
    const { results } = await runRound(queries);

    expect(peak).toBe(4);
    expect(results).toEqual(queries.map((q) => `摘要：${q}`));
  });
});

describe('prompt cache accounting', () => {
  function roundWithUsage(usage: LLMStreamEvent['usage'], ...events: LLMStreamEvent[]) {
    return [...events, { type: 'done', usage } as LLMStreamEvent];
  }

  test('sums cache hits across the rounds of a turn', async () => {
    const provider = scriptedProvider([
      roundWithUsage(
        { prompt_tokens: 1000, completion_tokens: 10, cached_tokens: 0, cache_write_tokens: 900 },
        toolCall('list_contacts_unknown'),
      ),
      roundWithUsage(
        { prompt_tokens: 1100, completion_tokens: 20, cached_tokens: 1000 },
        token('ok'),
      ),
    ]);
    await runAgentTurn({ ...baseOpts, recallMemory: false, provider });
    const line = groundingLine();
    expect(line).toContain('gen_ai.usage.input_tokens=2100');
    expect(line).toContain('gen_ai.usage.cache_read.input_tokens=1000');
    // Only the first round wrote; the second round reported no writes at all.
    expect(line).toContain('gen_ai.usage.cache_creation.input_tokens=900');
  });

  test('says nothing about hits when no round reported them', async () => {
    const provider = scriptedProvider([
      roundWithUsage({ prompt_tokens: 50, completion_tokens: 5 }, token('ok')),
    ]);
    await runAgentTurn({ ...baseOpts, recallMemory: false, provider });
    expect(groundingLine()).not.toContain('cache_read');
  });

  test('sends the stable system prompt as its own message when nothing was recalled', async () => {
    let sent: LLMMessage[] = [];
    const provider: LLMProvider = {
      name: 'scripted',
      async chat(): Promise<LLMResponse> {
        throw new Error('not used');
      },
      async *stream(messages): AsyncGenerator<LLMStreamEvent> {
        sent = messages;
        yield token('ok');
      },
    };
    await runAgentTurn({ ...baseOpts, provider });
    expect(sent.filter((m) => m.role === 'system')).toEqual([
      { role: 'system', content: 'You are a test agent.' },
    ]);
  });
});

// A tool's error names what the gateway talks to — a local runtime's address,
// an internal service — and on a peer's turn the model can repeat whatever it is
// handed straight back over the wire. `web_search` with arguments that are not
// JSON is a tool that throws without needing a network or a database.
describe('a tool that fails', () => {
  async function failedToolResult(audience: 'owner' | 'peer'): Promise<string> {
    const results: string[] = [];
    await runAgentTurn({
      ...baseOpts,
      audience,
      recallMemory: false,
      provider: scriptedProvider([[toolCall('web_search', 'not json')], [token('ok')]]),
      emit: {
        onToolResult: (result) => {
          results.push(result);
        },
      },
    });
    return results[0] ?? '';
  }

  test('tells the owner why', async () => {
    expect(await failedToolResult('owner')).toMatch(/^工具调用失败: .+/);
  });

  test('tells a peer only that it failed', async () => {
    expect(await failedToolResult('peer')).toBe('工具调用失败');
  });
});
