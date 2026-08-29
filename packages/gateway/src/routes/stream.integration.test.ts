import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { agents, conversationParticipants, conversations, messages } from '../db/schema.js';
import { get, mockFetch, put, resetDb, type SeededUser, seedUser } from '../test/helpers.js';

let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

async function seedConversation(createdBy: string): Promise<string> {
  const id = newId();
  await getDb()
    .insert(conversations)
    .values({ id, type: 'direct_user_agent', created_by: createdBy });
  return id;
}

async function seedMessage(conversationId: string, senderId: string): Promise<string> {
  const id = newId();
  await getDb().insert(messages).values({
    id,
    conversation_id: conversationId,
    sender_type: 'user',
    sender_id: senderId,
    content: 'hello',
  });
  return id;
}

describe('GET /stream/:conversationId/:messageId guards', () => {
  test('requires authentication', async () => {
    expect((await get('/api/v1/stream/c/m')).status).toBe(401);
  });

  test('404s when the message does not exist', async () => {
    const res = await get('/api/v1/stream/01HZZZZZZZZZZZZZZZZZZZZZZZ/01HZZZZZZZZZZZZZZZZZZZZZZZ', {
      token: user.token,
    });
    expect(res.status).toBe(404);
  });

  test('403s when the caller is not a participant', async () => {
    const owner = await seedUser();
    const convId = await seedConversation(owner.id);
    const msgId = await seedMessage(convId, owner.id);

    const res = await get(`/api/v1/stream/${convId}/${msgId}`, { token: user.token });
    expect(res.status).toBe(403);
  });

  test('404s when the participant has no agent configured', async () => {
    const convId = await seedConversation(user.id);
    const msgId = await seedMessage(convId, user.id);
    await getDb().insert(conversationParticipants).values({
      id: newId(),
      conversation_id: convId,
      participant_type: 'user',
      user_id: user.id,
      role: 'admin',
    });

    const res = await get(`/api/v1/stream/${convId}/${msgId}`, { token: user.token });
    expect(res.status).toBe(404);
  });
});

async function seedParticipant(conversationId: string, userId: string): Promise<void> {
  await getDb().insert(conversationParticipants).values({
    id: newId(),
    conversation_id: conversationId,
    participant_type: 'user',
    user_id: userId,
    role: 'admin',
  });
}

async function seedAgent(
  userId: string,
  modelConfig: Record<string, unknown> = { provider: 'openai' },
): Promise<void> {
  await getDb()
    .insert(agents)
    .values({
      id: newId(),
      user_id: userId,
      did: `did:web:localhost:agents:a-${newId().toLowerCase()}`,
      model_config_json: modelConfig,
    });
}

function parseSSE(raw: string): Array<{ event: string; data: string }> {
  return raw
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      const event =
        lines
          .find((l) => l.startsWith('event:'))
          ?.slice(6)
          .trim() ?? 'message';
      const data =
        lines
          .find((l) => l.startsWith('data:'))
          ?.slice(5)
          .trim() ?? '';
      return { event, data };
    });
}

describe('GET /stream tool execution', () => {
  let restoreFetch: () => void;

  afterEach(() => restoreFetch?.());

  // An agent with nothing configured used to be pointed at a hardcoded
  // 'anthropic' and dialled with whatever key happened to be around — so the
  // reader was told their turn failed with a 401 from a vendor they may never
  // have heard of, instead of that they have not picked a model yet.
  test.each([
    [{}, 'no_model_configured'],
    [{ provider: 'openai' }, 'no_key_for_provider'],
  ])('reports %o as a configuration problem, without calling a model', async (config, code) => {
    const convId = await seedConversation(user.id);
    const msgId = await seedMessage(convId, user.id);
    await seedParticipant(convId, user.id);
    await seedAgent(user.id, config);

    let calls = 0;
    restoreFetch = mockFetch((url) => {
      if (url.includes('/embeddings')) return undefined;
      calls++;
      return new Response('{}', { status: 401 });
    });

    const res = await get(`/api/v1/stream/${convId}/${msgId}`, { token: user.token });
    const events = parseSSE(await res.text());

    const error = events.find((e) => e.event === 'error');
    if (!error) throw new Error('expected an error event in the stream');
    expect(JSON.parse(error.data).message).toBe(code);
    expect(calls).toBe(0);

    // And nothing was written: a turn that never ran must stay replayable.
    expect(
      await getDb().select().from(messages).where(eq(messages.in_reply_to, msgId)),
    ).toHaveLength(0);
  });

  test('tool_result event carries the tool output, not the tool name', async () => {
    const convId = await seedConversation(user.id);
    const msgId = await seedMessage(convId, user.id);
    await seedParticipant(convId, user.id);
    await seedAgent(user.id);

    // Both keys go through the real settings endpoint (encrypted at rest):
    // 'openai' backs the chat provider, 'tavily' enables the web_search tool.
    await put('/api/v1/agents/me/llm-keys', {
      token: user.token,
      body: { provider: 'openai', api_key: 'sk-test-llm' },
    });
    await put('/api/v1/agents/me/llm-keys', {
      token: user.token,
      body: { provider: 'tavily', api_key: 'tvly-test' },
    });

    let llmCall = 0;
    restoreFetch = mockFetch((url) => {
      if (url.includes('api.tavily.com')) {
        return Response.json({ answer: 'TAVILY_MARKER_42', results: [] });
      }
      // Memory recall embeds the user message before the chat call. Stub it so it
      // doesn't consume the llmCall counter that sequences the chat rounds below.
      if (url.includes('/embeddings')) {
        const v = new Array(1536).fill(0);
        v[0] = 1;
        return Response.json({ data: [{ embedding: v, index: 0 }] });
      }
      if (url.includes('api.openai.com')) {
        // Round 0: request a web_search tool call. Round 1: reply in plain text.
        const body =
          llmCall++ === 0
            ? 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"web_search","arguments":"{\\"query\\":\\"weather\\"}"}}]}}]}\n\ndata: [DONE]\n\n'
            : 'data: {"choices":[{"delta":{"content":"Done."}}]}\n\ndata: [DONE]\n\n';
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      return undefined;
    });

    const res = await get(`/api/v1/stream/${convId}/${msgId}`, { token: user.token });
    expect(res.status).toBe(200);

    const events = parseSSE(await res.text());
    const toolResult = events.find((e) => e.event === 'tool_result');
    if (!toolResult) throw new Error('expected a tool_result event in the stream');

    const payload = JSON.parse(toolResult.data) as { result: string };
    // Regression: this previously sent { result: tc.name }, i.e. "web_search".
    expect(payload.result).toBe('摘要：TAVILY_MARKER_42');
    expect(payload.result).not.toBe('web_search');
  });

  // Regression: the model picked in Agent settings was persisted to
  // model_config_json.model and then never read, so every call silently used the
  // provider's hardcoded default. Nothing failed loudly for the cloud providers
  // — you just got billed for a model you did not choose — and Ollama 404'd on
  // its `llama3` default. Assert the configured id reaches the wire.
  test('sends the model configured in agent settings, not the provider default', async () => {
    const convId = await seedConversation(user.id);
    const msgId = await seedMessage(convId, user.id);
    await seedParticipant(convId, user.id);
    await seedAgent(user.id, { provider: 'openai', model: 'gpt-4.1-mini' });

    await put('/api/v1/agents/me/llm-keys', {
      token: user.token,
      body: { provider: 'openai', api_key: 'sk-test-llm' },
    });

    const sentModels: string[] = [];
    restoreFetch = mockFetch((url, init) => {
      if (url.includes('/embeddings')) {
        const v = new Array(1536).fill(0);
        v[0] = 1;
        return Response.json({ data: [{ embedding: v, index: 0 }] });
      }
      if (!url.includes('/chat/completions')) return undefined;
      sentModels.push(JSON.parse(String(init?.body)).model);
      return new Response('data: {"choices":[{"delta":{"content":"Hi."}}]}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });

    const res = await get(`/api/v1/stream/${convId}/${msgId}`, { token: user.token });
    expect(res.status).toBe(200);
    await res.text();

    // Assert every chat call rather than an exact list: memory extraction is
    // fire-and-forget, so whether its (also model-carrying) call has landed by
    // now is a race. The turn itself is always the first.
    expect(sentModels[0]).toBe('gpt-4.1-mini');
    expect(sentModels.every((m) => m === 'gpt-4.1-mini')).toBe(true);
  });
});

// This endpoint is a GET that calls the model and writes a row, and nothing
// stopped it doing that twice for the same message. Reproduced against the
// running stack: two identical replies to one question, 25 seconds apart,
// because the stream URL was requested a second time.
describe('GET /stream is idempotent per message', () => {
  let restoreFetch: () => void;

  afterEach(() => restoreFetch?.());

  /** A provider that answers once and counts how often it was asked. */
  function countingProvider(): { calls: () => number } {
    let calls = 0;
    restoreFetch = mockFetch((url) => {
      if (url.includes('/embeddings')) {
        const v = new Array(1536).fill(0);
        v[0] = 1;
        return Response.json({ data: [{ embedding: v, index: 0 }] });
      }
      if (!url.includes('/chat/completions')) return undefined;
      calls++;
      return new Response('data: {"choices":[{"delta":{"content":"Once."}}]}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    return { calls: () => calls };
  }

  async function seedTurn(): Promise<{ convId: string; msgId: string }> {
    const convId = await seedConversation(user.id);
    const msgId = await seedMessage(convId, user.id);
    await seedParticipant(convId, user.id);
    await seedAgent(user.id, { provider: 'openai', model: 'gpt-4.1-mini' });
    await put('/api/v1/agents/me/llm-keys', {
      token: user.token,
      body: { provider: 'openai', api_key: 'sk-test-llm' },
    });
    return { convId, msgId };
  }

  test('replays the stored answer instead of generating a second one', async () => {
    const { convId, msgId } = await seedTurn();
    const provider = countingProvider();

    const first = await get(`/api/v1/stream/${convId}/${msgId}`, { token: user.token });
    await first.text();
    const generated = provider.calls();

    // The reconnect: same URL, after the turn finished.
    const second = await get(`/api/v1/stream/${convId}/${msgId}`, { token: user.token });
    const events = parseSSE(await second.text());

    // The answer still arrives — a reload must not leave the reader with a
    // blank bubble — but no further completion was bought to produce it.
    expect(events.find((e) => e.event === 'token')?.data).toContain('Once.');
    expect(events.at(-1)?.event).toBe('done');
    expect(provider.calls()).toBe(generated);

    const replies = await getDb()
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.in_reply_to, msgId));
    expect(replies).toHaveLength(1);
  });

  test('declines a second turn while the first is still running', async () => {
    const { convId, msgId } = await seedTurn();

    // Hold the first turn open rather than racing two requests and hoping they
    // overlap: a test that depends on scheduling passes for the wrong reason as
    // readily as it fails for one.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const SSE_BODY = 'data: {"choices":[{"delta":{"content":"Once."}}]}\n\ndata: [DONE]\n\n';
    let calls = 0;
    restoreFetch = mockFetch((url) => {
      if (url.includes('/embeddings')) {
        const v = new Array(1536).fill(0);
        v[0] = 1;
        return Response.json({ data: [{ embedding: v, index: 0 }] });
      }
      if (!url.includes('/chat/completions')) return undefined;
      const first = calls++ === 0;
      // The first call answers only once released. A stalled body is what a
      // slow model looks like from here, and it keeps the turn genuinely in
      // flight while the second request arrives.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const finish = () => {
            controller.enqueue(new TextEncoder().encode(SSE_BODY));
            controller.close();
          };
          if (first) void held.then(finish);
          else finish();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });

    const first = get(`/api/v1/stream/${convId}/${msgId}`, { token: user.token }).then((r) =>
      r.text(),
    );
    // Wait until the held turn is actually at the provider, so the second
    // request arrives mid-generation rather than before the claim was taken.
    while (calls === 0) await new Promise((r) => setTimeout(r, 5));

    const second = await get(`/api/v1/stream/${convId}/${msgId}`, { token: user.token });
    const events = parseSSE(await second.text());

    // Told why, rather than handed a silent empty stream. The answer still
    // reaches this client over the WS broadcast the first turn sends.
    expect(events.find((e) => e.event === 'error')?.data).toContain('already_generating');
    expect(calls).toBe(1);

    release();
    await first;

    const replies = await getDb()
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.in_reply_to, msgId));
    expect(replies).toHaveLength(1);
  });
});

// The window was ordered ascending and limited to 20, which returns the twenty
// OLDEST messages. Past that many, the agent re-read the opening of the
// conversation on every turn and never saw anything said recently.
describe('GET /stream conversation history window', () => {
  let restoreFetch: () => void;

  afterEach(() => restoreFetch?.());

  test('sends the most recent messages, not the first ones', async () => {
    const convId = await seedConversation(user.id);
    await seedParticipant(convId, user.id);
    await seedAgent(user.id, { provider: 'openai', model: 'gpt-4.1-mini' });
    await put('/api/v1/agents/me/llm-keys', {
      token: user.token,
      body: { provider: 'openai', api_key: 'sk-test-llm' },
    });

    // 30 earlier messages, then the one being answered. These are written as
    // fast as the machine allows, so most of them share a millisecond — which
    // is exactly the case that used to break the window: ids were random
    // within one, and this test failed about half the time on CI because of
    // it. `newId` is monotonic now, and the window pages by that id.
    for (let i = 0; i < 30; i++) {
      await getDb()
        .insert(messages)
        .values({
          id: newId(),
          conversation_id: convId,
          sender_type: 'user',
          sender_id: user.id,
          content: `earlier-${i}`,
        });
    }
    const msgId = await seedMessage(convId, user.id);

    let sentHistory: Array<{ content: string }> = [];
    restoreFetch = mockFetch((url, init) => {
      if (url.includes('/embeddings')) {
        const v = new Array(1536).fill(0);
        v[0] = 1;
        return Response.json({ data: [{ embedding: v, index: 0 }] });
      }
      if (!url.includes('/chat/completions')) return undefined;
      if (sentHistory.length === 0) {
        sentHistory = JSON.parse(String(init?.body)).messages as Array<{ content: string }>;
      }
      return new Response('data: {"choices":[{"delta":{"content":"Hi."}}]}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });

    await (await get(`/api/v1/stream/${convId}/${msgId}`, { token: user.token })).text();

    const sent = sentHistory.map((m) => m.content).join('\n');
    expect(sent).toContain('earlier-29');
    expect(sent).toContain('earlier-10');
    expect(sent).not.toContain('earlier-0\n');
    expect(sent).not.toContain('earlier-9\n');
  });
});
