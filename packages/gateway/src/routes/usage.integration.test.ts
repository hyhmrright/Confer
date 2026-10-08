import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { getDb } from '../db/connection.js';
import {
  agents,
  conversationParticipants,
  conversations,
  llmUsage,
  messages,
} from '../db/schema.js';
import { settleDetached } from '../lib/background.js';
import { get, mockFetch, put, resetDb, type SeededUser, seedUser } from '../test/helpers.js';

interface UsageRow {
  provider: string;
  model: string | null;
  audience: string;
  turns: number;
  unreported: number;
  failed: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
}

let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

async function seedAgent(userId: string): Promise<string> {
  const id = newId();
  await getDb()
    .insert(agents)
    .values({
      id,
      user_id: userId,
      did: `did:web:localhost:agents:a-${newId().toLowerCase()}`,
      model_config_json: { provider: 'openai', model: 'gpt-4.1-mini' },
    });
  return id;
}

async function usage(month?: string): Promise<{ month: string; rows: UsageRow[] }> {
  const res = await get(`/api/v1/usage${month ? `?month=${month}` : ''}`, { token: user.token });
  expect(res.status).toBe(200);
  return res.json();
}

describe('GET /usage', () => {
  let restoreFetch: (() => void) | undefined;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
  });

  test('requires authentication', async () => {
    expect((await get('/api/v1/usage')).status).toBe(401);
  });

  test('rejects a month that is not YYYY-MM', async () => {
    const res = await get('/api/v1/usage?month=2026-13', { token: user.token });
    expect(res.status).toBe(400);
  });

  // Driven through the real chat path: the usage the vendor reports on its
  // final chunk has to survive the provider, the tool loop's sum and the
  // detached insert before the panel can show it.
  test('counts a real chat turn with the usage its vendor reported', async () => {
    await seedAgent(user.id);
    const convId = newId();
    await getDb()
      .insert(conversations)
      .values({ id: convId, type: 'direct_user_agent', created_by: user.id });
    await getDb().insert(conversationParticipants).values({
      id: newId(),
      conversation_id: convId,
      participant_type: 'user',
      user_id: user.id,
      role: 'admin',
    });
    const msgId = newId();
    await getDb().insert(messages).values({
      id: msgId,
      conversation_id: convId,
      sender_type: 'user',
      sender_id: user.id,
      content: 'hello',
    });
    await put('/api/v1/agents/me/llm-keys', {
      token: user.token,
      body: { provider: 'openai', api_key: 'sk-test-llm' },
    });

    let turnCalls = 0;
    restoreFetch = mockFetch((url) => {
      if (url.includes('/embeddings')) {
        const v = new Array(1536).fill(0);
        v[0] = 1;
        return Response.json({ data: [{ embedding: v, index: 0 }] });
      }
      if (!url.includes('/chat/completions')) return undefined;
      // The second call is memory extraction, which is not an agent turn and
      // must not appear in the panel.
      if (turnCalls++ > 0) return Response.json({ choices: [{ message: { content: '[]' } }] });
      const body =
        'data: {"choices":[{"delta":{"content":"Hi."}}]}\n\n' +
        'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":8,"prompt_tokens_details":{"cached_tokens":100}}}\n\n' +
        'data: [DONE]\n\n';
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });

    const res = await get(`/api/v1/stream/${convId}/${msgId}`, { token: user.token });
    await res.text();
    await settleDetached();

    const { rows } = await usage();
    expect(rows).toEqual([
      {
        provider: 'openai',
        model: 'gpt-4.1-mini',
        audience: 'owner',
        turns: 1,
        unreported: 0,
        failed: 0,
        input_tokens: 120,
        output_tokens: 8,
        cache_read_tokens: 100,
        cache_write_tokens: null,
      },
    ]);
  });

  test('sums by model and audience, keeping unreported turns out of the totals', async () => {
    const agentId = await seedAgent(user.id);
    const row = (overrides: Partial<typeof llmUsage.$inferInsert>) => ({
      id: newId(),
      user_id: user.id,
      agent_id: agentId,
      audience: 'owner',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      rounds: 1,
      input_tokens: 100,
      output_tokens: 10,
      created_at: new Date('2026-09-15T12:00:00Z'),
      ...overrides,
    });
    await getDb()
      .insert(llmUsage)
      .values([
        row({}),
        row({ input_tokens: 50, output_tokens: 5, error_type: 'TypeError' }),
        row({ input_tokens: null, output_tokens: null }),
        row({ audience: 'peer', input_tokens: 7, output_tokens: 3 }),
        // Either side of September, both excluded.
        row({ created_at: new Date('2026-08-31T23:59:59Z') }),
        row({ created_at: new Date('2026-10-01T00:00:00Z') }),
      ]);

    const { month, rows } = await usage('2026-09');
    expect(month).toBe('2026-09');
    const byAudience = Object.fromEntries(rows.map((r) => [r.audience, r]));
    expect(byAudience.owner).toMatchObject({
      turns: 3,
      unreported: 1,
      failed: 1,
      input_tokens: 150,
      output_tokens: 15,
    });
    expect(byAudience.peer).toMatchObject({ turns: 1, input_tokens: 7, output_tokens: 3 });
  });

  test("never shows another owner's turns", async () => {
    const other = await seedUser();
    const otherAgent = await seedAgent(other.id);
    await getDb().insert(llmUsage).values({
      id: newId(),
      user_id: other.id,
      agent_id: otherAgent,
      audience: 'owner',
      provider: 'openai',
      rounds: 1,
      input_tokens: 999,
      output_tokens: 999,
    });

    expect((await usage()).rows).toEqual([]);
  });
});
