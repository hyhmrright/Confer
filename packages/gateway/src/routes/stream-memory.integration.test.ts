import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { encrypt, newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { agents, conversationParticipants, conversations, messages, users } from '../db/schema.js';
import { getEnv } from '../env.js';
import { deleteMemory, ensureMemoryCollection, searchMemories } from '../lib/memory-store.js';
import {
  apiRequest,
  headers,
  mockFetch,
  resetDb,
  type SeededUser,
  seedUser,
} from '../test/helpers.js';

// The durable fact stored on turn 1 and expected back in turn 2's prompt.
const FACT = '用户偏好 TypeScript';

// The message list of each *streaming* (reply) LLM call, captured for assertions.
type WireMessage = { role: string; content: string };
let capturedStreamCalls: WireMessage[][] = [];

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
//                    the fact, so the only way FACT reaches the turn-2 prompt
//                    is via memory recall injection). Messages captured.
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
        messages: WireMessage[];
      };
      if (body.stream) {
        capturedStreamCalls.push(body.messages);
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
    capturedStreamCalls = [];
  });

  afterEach(() => restore?.());

  test('a fact stored on turn 1 is recalled into turn 2, behind an unchanged prefix', async () => {
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

    // Poll until the fact is *recall-searchable* (no fixed sleep). Gating on the
    // `agent_memories` row instead would be the wrong signal: extraction writes the
    // PG row before the Qdrant upsert (see tools/memory.ts), so the row can appear
    // while the vector is still missing — turn 2 then recalls nothing and the test
    // fails for a reason that has nothing to do with recall. The mock MUST stay
    // active here: extraction runs after the SSE drain, so restoring fetch too
    // early would make its embedding/LLM calls hit the real network and fail.
    const deadline = Date.now() + 5000;
    let recallable = 0;
    while (Date.now() < deadline) {
      recallable = (await searchMemories(embedVector('TypeScript'), u.id, 1)).length;
      if (recallable > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    restore();
    restore = undefined;
    // Guard: the fact must be recall-searchable, else the recall test below is vacuous.
    expect(recallable).toBeGreaterThan(0);

    // Turn 2: a related query. The streamed reply ('明白') does NOT contain FACT,
    // so the only path for FACT into the prompt is recall injection.
    const [turn1] = capturedStreamCalls;
    capturedStreamCalls = [];
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
    expect(capturedStreamCalls.length).toBe(1);
    const turn2 = capturedStreamCalls[0] ?? [];
    expect(turn2.at(-1)?.role).toBe('user');
    expect(turn2.at(-1)?.content).toContain(FACT);
    expect(turn2.find((m) => m.role === 'system')?.content).not.toContain(FACT);

    // What the prompt cache depends on, checked on the wire: turn 2 begins with
    // exactly what turn 1 sent. That holds here only because turn 1 recalled
    // nothing (the memory store was empty); a turn-1 question carrying memories
    // would, by design, come back bare in turn 2's history. Recall used to write into the system prompt,
    // so the first message already differed and nothing could be reused.
    expect(turn1).toBeDefined();
    expect(turn2.slice(0, turn1?.length)).toEqual(turn1 ?? []);
  });

  test('stream completes and persists the reply even if memory (embedding) fails', async () => {
    const { u, convId } = await setupUserWithAgent();

    // Embeddings always 503 → both the recall (pre-reply, try/catch best-effort)
    // and the fire-and-forget extraction path fail. The /chat/completions reply
    // is served normally so the agent still answers.
    const replyText = '这是回答';
    restore = mockFetch((url, init) => {
      if (url.includes('/embeddings')) {
        return new Response('embedding unavailable', { status: 503 });
      }
      if (url.includes('/chat/completions')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { stream?: boolean };
        if (body.stream) {
          const chunks = [
            `data: ${JSON.stringify({ choices: [{ delta: { content: replyText } }] })}\n\n`,
            'data: [DONE]\n\n',
          ];
          return new Response(chunks.join(''), {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          });
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '[]' }, finish_reason: 'stop' }],
            usage: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      // Short-circuit any other external call so a stray request can't hang.
      if (url.includes('openai.com') || url.includes('tavily.com')) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '[]' } }], data: [] }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      return undefined;
    });

    const msgId = await postUserMessage(convId, u.id, '帮我回答一个问题');
    const res = await apiRequest(`/api/v1/stream/${convId}/${msgId}`, {
      method: 'GET',
      headers: headers({ token: u.token }),
    });

    // The SSE stream must succeed (200) and stream the reply tokens + a done
    // event — the memory failure is swallowed, not propagated.
    expect(res.status).toBe(200);
    const sse = await res.text();
    expect(sse).toContain(replyText);
    expect(sse).toContain('event: done');
    expect(sse).not.toContain('event: error');

    // The assistant reply was persisted despite the embedding outage.
    const reply = await (
      await apiRequest(`/api/v1/conversations/${convId}/messages`, {
        method: 'GET',
        headers: headers({ token: u.token }),
      })
    ).json();
    const agentMsg = reply.messages.find(
      (m: { sender_type: string; content: string }) => m.sender_type === 'agent',
    );
    expect(agentMsg?.content).toBe(replyText);
  });
});
