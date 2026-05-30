import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import {
  agentMemories,
  agents,
  conversationParticipants,
  conversations,
  messages,
} from '../db/schema.js';
import { ensureMemoryCollection } from '../lib/memory-store.js';
import { type SeededUser, get, mockFetch, put, resetDb, seedUser } from '../test/helpers.js';

let u: SeededUser;

beforeEach(async () => {
  await resetDb();
  await ensureMemoryCollection();
  u = await seedUser();
});

async function seedConversation(createdBy: string): Promise<string> {
  const id = newId();
  await getDb()
    .insert(conversations)
    .values({ id, type: 'direct_user_agent', created_by: createdBy });
  return id;
}

async function seedMessage(
  conversationId: string,
  senderId: string,
  content: string,
): Promise<string> {
  const id = newId();
  await getDb().insert(messages).values({
    id,
    conversation_id: conversationId,
    sender_type: 'user',
    sender_id: senderId,
    content,
  });
  return id;
}

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

describe('stream memory extraction', () => {
  let restoreFetch: () => void;

  afterEach(() => restoreFetch?.());

  test('fire-and-forget extraction persists fact; turn 2 recall includes it', async () => {
    const convId = await seedConversation(u.id);
    await seedParticipant(convId, u.id);
    await seedAgent(u.id);

    await put('/api/v1/agents/me/llm-keys', {
      token: u.token,
      body: { provider: 'openai', api_key: 'sk-test-mem' },
    });

    // Track LLM call index so we can serve different responses per turn.
    let llmCall = 0;

    restoreFetch = mockFetch((url, init) => {
      if (url.includes('/embeddings')) {
        // Stub embedding: unit vector hot at hash(input[0]).
        const body = JSON.parse(String(init?.body ?? '{}')) as { input: string[] };
        const data = body.input.map((text, i) => {
          const v = new Array(1536).fill(0);
          let h = 0;
          for (const ch of text) h = (h + ch.charCodeAt(0)) % 1536;
          v[h] = 1;
          return { embedding: v, index: i };
        });
        return new Response(JSON.stringify({ data }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.includes('api.openai.com/v1/chat')) {
        // Turn 1 (calls 0-1): LLM says user prefers TypeScript; extraction call returns fact JSON.
        // Turn 2 (calls 2+): LLM echoes back whatever memories were injected.
        if (llmCall === 0) {
          llmCall++;
          return new Response(
            'data: {"choices":[{"delta":{"content":"好的，我知道你偏好 TypeScript。"}}]}\n\ndata: [DONE]\n\n',
            { status: 200, headers: { 'content-type': 'text/event-stream' } },
          );
        }
        if (llmCall === 1) {
          // Memory extraction LLM call: return fact list JSON.
          llmCall++;
          return new Response(
            'data: {"choices":[{"delta":{"content":"[\\"用户偏好 TypeScript\\"]"}}]}\n\ndata: [DONE]\n\n',
            { status: 200, headers: { 'content-type': 'text/event-stream' } },
          );
        }
        // Turn 2 chat + optional extraction calls.
        llmCall++;
        return new Response(
          'data: {"choices":[{"delta":{"content":"用户偏好 TypeScript，已记住。"}}]}\n\ndata: [DONE]\n\n',
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      }

      return undefined;
    });

    // Turn 1: send first message, drain the SSE.
    const msg1Id = await seedMessage(convId, u.id, '我偏好 TypeScript');
    const res1 = await get(`/api/v1/stream/${convId}/${msg1Id}`, { token: u.token });
    expect(res1.status).toBe(200);
    const events1 = parseSSE(await res1.text());
    expect(events1.some((e) => e.event === 'done')).toBe(true);

    // Wait for the fire-and-forget extraction to persist the fact (poll, no fixed sleep).
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const rows = await getDb()
        .select()
        .from(agentMemories)
        .where(eq(agentMemories.user_id, u.id));
      if (rows.length > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    // Turn 2: send second message; the stream route should inject recalled memories.
    const msg2Id = await seedMessage(convId, u.id, '你还记得我的偏好吗？');
    const res2 = await get(`/api/v1/stream/${convId}/${msg2Id}`, { token: u.token });
    expect(res2.status).toBe(200);
    const text2 = await res2.text();

    // The recalled memory fragment must appear somewhere in the streamed tokens.
    expect(text2).toContain('用户偏好 TypeScript');
  });
});
