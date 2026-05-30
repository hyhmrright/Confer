import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { encrypt, newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import {
  agentMemories,
  agents,
  conversationParticipants,
  conversations,
  messages,
  users,
} from '../db/schema.js';
import { getEnv } from '../env.js';
import { deleteMemory, ensureMemoryCollection } from '../lib/memory-store.js';
import {
  type SeededUser,
  apiRequest,
  headers,
  mockFetch,
  resetDb,
  seedUser,
} from '../test/helpers.js';

// The durable fact stored on turn 1 and expected back in the turn-2 system prompt.
const FACT = '用户偏好 TypeScript';

// System prompts seen by the *streaming* (reply) LLM calls, captured for assertions.
let capturedSystemPrompts: string[] = [];

// Deterministic embedding stub. Any text mentioning 'TypeScript' maps to one
// fixed hot index, so the turn-2 query ('TypeScript 有什么技巧') and the stored
// fact ('用户偏好 TypeScript') produce the SAME unit vector → cosine 1.0, which
// clears the recall/dedup thresholds. Unrelated text falls back to a char-sum
// hash so it stays (mostly) orthogonal.
function embedVector(text: string): number[] {
  const v = new Array(1536).fill(0);
  if (text.includes('TypeScript')) {
    v[42] = 1;
    return v;
  }
  let h = 0;
  for (const ch of text) h = (h + ch.charCodeAt(0)) % 1536;
  v[h] = 1;
  return v;
}

// Mocks the embedding API and the LLM /chat/completions endpoint. The route's
// streaming reply path and the fire-and-forget extraction path BOTH hit
// /chat/completions; they are distinguished by body.stream:
//   - stream:true  → the streamed assistant reply (deliberately does NOT contain
//                    the fact, so the only way FACT reaches the turn-2 system
//                    prompt is via memory recall injection). System prompt captured.
//   - stream:false → the extraction call; extractFacts() does response.json(),
//                    so this MUST be plain JSON (not SSE) returning the fact list.
function mockOpenAIAndEmbedding(replyText: string, facts: string[]): () => void {
  return mockFetch((url, init) => {
    if (url.includes('/embeddings')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { input: string[] };
      const data = body.input.map((text, i) => ({ embedding: embedVector(text), index: i }));
      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/chat/completions')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        stream?: boolean;
        messages: Array<{ role: string; content: string }>;
      };
      if (body.stream) {
        capturedSystemPrompts.push(body.messages.find((m) => m.role === 'system')?.content ?? '');
        const chunks = [
          `data: ${JSON.stringify({ choices: [{ delta: { content: replyText } }] })}\n\n`,
          'data: [DONE]\n\n',
        ];
        return new Response(chunks.join(''), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      // Non-streaming == fact extraction. extractFacts parses this JSON body.
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(facts) }, finish_reason: 'stop' }],
          usage: {},
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    // Never let an external (OpenAI/Tavily) call reach the real network — a
    // fire-and-forget extraction call that slips past the matchers above would
    // otherwise hang ~5s on a real connection. Our own infra (Qdrant/MinIO at
    // 127.0.0.1) must still pass through, so only short-circuit external hosts.
    if (url.includes('openai.com') || url.includes('tavily.com')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '[]' } }], data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return undefined;
  });
}

async function setupUserWithAgent(): Promise<{ u: SeededUser; convId: string }> {
  const u = await seedUser();
  const env = getEnv();
  // encrypt(plaintext, keyHex) returns a Result — unwrap .value to store the
  // EncryptedValue shape ({ciphertext, iv, tag}) that the route expects.
  const encResult = await encrypt('sk-test-mem', env.ENCRYPTION_KEY);
  if (!encResult.ok) throw new Error(encResult.error);
  await getDb()
    .update(users)
    .set({ llm_keys_json: { openai: encResult.value } })
    .where(eq(users.id, u.id));

  await getDb()
    .insert(agents)
    .values({
      id: newId(),
      user_id: u.id,
      did: `${u.did}:agent`,
      model_config_json: { provider: 'openai', system_prompt: '你是助手。' },
    });

  const convId = newId();
  await getDb().insert(conversations).values({ id: convId, type: 'direct', created_by: u.id });
  await getDb().insert(conversationParticipants).values({
    id: newId(),
    conversation_id: convId,
    participant_type: 'user',
    user_id: u.id,
  });
  return { u, convId };
}

async function postUserMessage(convId: string, userId: string, text: string): Promise<string> {
  const id = newId();
  await getDb().insert(messages).values({
    id,
    conversation_id: convId,
    sender_type: 'user',
    sender_id: userId,
    content_type: 'text',
    content: text,
  });
  return id;
}

describe('stream long-term memory', () => {
  let restore: (() => void) | undefined;

  beforeEach(async () => {
    await resetDb();
    await ensureMemoryCollection();
    capturedSystemPrompts = [];
  });

  afterEach(() => restore?.());

  test('a fact stored on turn 1 is injected into the system prompt on turn 2', async () => {
    const { u, convId } = await setupUserWithAgent();
    await deleteMemory(u.id, undefined);

    // Turn 1: user states a preference. The non-streaming extraction call returns
    // FACT, which the fire-and-forget path embeds + persists.
    restore = mockOpenAIAndEmbedding('好的', [FACT]);
    const msg1 = await postUserMessage(convId, u.id, '我喜欢用 TypeScript');
    const res1 = await apiRequest(`/api/v1/stream/${convId}/${msg1}`, {
      method: 'GET',
      headers: headers({ token: u.token }),
    });
    await res1.text(); // drain SSE so the fire-and-forget extraction kicks off

    // Poll until the fire-and-forget extraction has persisted the fact (no fixed
    // sleep). The mock MUST stay active here: extraction runs after the SSE
    // drain, so restoring fetch too early would make its embedding/LLM calls hit
    // the real network and fail.
    const deadline = Date.now() + 5000;
    let persisted = 0;
    while (Date.now() < deadline) {
      const rows = await getDb()
        .select()
        .from(agentMemories)
        .where(eq(agentMemories.user_id, u.id));
      persisted = rows.length;
      if (persisted > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    restore();
    restore = undefined;
    // Guard: extraction must actually have stored the fact, else the recall test below is vacuous.
    expect(persisted).toBeGreaterThan(0);

    // Turn 2: a related query. The streamed reply ('明白') does NOT contain FACT,
    // so the only path for FACT into the system prompt is recall injection.
    capturedSystemPrompts = [];
    restore = mockOpenAIAndEmbedding('明白', []);
    const msg2 = await postUserMessage(convId, u.id, 'TypeScript 有什么技巧');
    const res2 = await apiRequest(`/api/v1/stream/${convId}/${msg2}`, {
      method: 'GET',
      headers: headers({ token: u.token }),
    });
    await res2.text();
    restore();
    restore = undefined;

    // Exactly one streaming reply call should have happened on turn 2.
    expect(capturedSystemPrompts.length).toBe(1);
    const sysPrompt = capturedSystemPrompts[0];
    expect(sysPrompt).toContain(FACT);
  });
});
