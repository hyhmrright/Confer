import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { getDb } from '../db/connection.js';
import { agents, conversationParticipants, conversations, messages } from '../db/schema.js';
import { type SeededUser, get, mockFetch, put, resetDb, seedUser } from '../test/helpers.js';

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

async function seedAgent(userId: string): Promise<void> {
  await getDb()
    .insert(agents)
    .values({
      id: newId(),
      user_id: userId,
      did: `did:web:localhost:agents:a-${newId().toLowerCase()}`,
      model_config_json: { provider: 'openai' },
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
});
