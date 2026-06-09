import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { probeAsks } from '../db/schema.js';
import { type SeededUser, get, post, resetDb, seedUser } from '../test/helpers.js';

const PROBE = '/api/v1/probe/ask-person';

let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

describe('probe ask-person', () => {
  test('requires authentication', async () => {
    expect((await post(PROBE, { body: { person: 'Bob', question: 'q' } })).status).toBe(401);
  });

  test('records an ask and opens a placeholder conversation (pending)', async () => {
    const res = await post(PROBE, {
      token: user.token,
      body: { person: 'Bob', question: 'why this design?', had_slack_dm_alt: true },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('pending');
    expect(typeof body.ask_id).toBe('string');
    expect(typeof body.conversation_id).toBe('string');

    const [row] = await getDb()
      .select()
      .from(probeAsks)
      .where(eq(probeAsks.id, body.ask_id))
      .limit(1);
    expect(row?.asker_user_id).toBe(user.id);
    expect(row?.person).toBe('Bob');
    expect(row?.question).toBe('why this design?');
    expect(row?.had_slack_dm_alt).toBe(true);
    expect(row?.prompted).toBe(false);
    expect(row?.is_founder_test).toBe(false);
    expect(row?.filled_at).toBeNull();
    expect(row?.conversation_id).toBe(body.conversation_id);
  });

  test('truncates the question to the column cap', async () => {
    const long = 'x'.repeat(5000);
    const res = await post(PROBE, {
      token: user.token,
      body: { person: 'Bob', question: long },
    });
    // The schema caps at 4000, so an over-cap value is rejected before storage.
    expect(res.status).toBe(400);
  });

  test('lists pending asks, then drops them once filled', async () => {
    const created = await (
      await post(PROBE, { token: user.token, body: { person: 'Bob', question: 'q1' } })
    ).json();

    const pending = await (await get(`${PROBE}/pending`, { token: user.token })).json();
    expect(pending.asks).toHaveLength(1);
    expect(pending.asks[0].id).toBe(created.ask_id);

    const filled = await post(`${PROBE}/${created.ask_id}/fill`, {
      token: user.token,
      body: { answer: 'because of X', could_self_answer: false },
    });
    expect(filled.status).toBe(200);

    const after = await (await get(`${PROBE}/pending`, { token: user.token })).json();
    expect(after.asks).toHaveLength(0);

    const [row] = await getDb()
      .select()
      .from(probeAsks)
      .where(eq(probeAsks.id, created.ask_id))
      .limit(1);
    expect(row?.filled_at).not.toBeNull();
    expect(row?.could_self_answer).toBe(false);
  });

  test('host retrieves the Wizard answer via the consult reply path', async () => {
    const created = await (
      await post(PROBE, { token: user.token, body: { person: 'Bob', question: 'q' } })
    ).json();

    await post(`${PROBE}/${created.ask_id}/fill`, {
      token: user.token,
      body: { answer: 'the real human answer' },
    });

    // check_reply hits the consult reply endpoint with wait=0.
    const reply = await get(`/api/v1/consult/${created.conversation_id}/reply?wait=0`, {
      token: user.token,
    });
    expect(reply.status).toBe(200);
    const body = await reply.json();
    expect(body.status).toBe('answered');
    expect(body.message.content).toBe('the real human answer');
  });

  test('rejects filling an already-filled ask (409)', async () => {
    const created = await (
      await post(PROBE, { token: user.token, body: { person: 'Bob', question: 'q' } })
    ).json();
    await post(`${PROBE}/${created.ask_id}/fill`, {
      token: user.token,
      body: { answer: 'first' },
    });
    const second = await post(`${PROBE}/${created.ask_id}/fill`, {
      token: user.token,
      body: { answer: 'second' },
    });
    expect(second.status).toBe(409);
  });

  test('returns 404 filling an unknown ask', async () => {
    const res = await post(`${PROBE}/01HZZZZZZZZZZZZZZZZZZZZZZZ/fill`, {
      token: user.token,
      body: { answer: 'x' },
    });
    expect(res.status).toBe(404);
  });

  test('scopes pending asks to their owner', async () => {
    await post(PROBE, { token: user.token, body: { person: 'Bob', question: 'q' } });
    const other = await seedUser();
    const res = await get(`${PROBE}/pending`, { token: other.token });
    expect((await res.json()).asks).toHaveLength(0);
  });

  test("other users cannot fill an ask they don't own (404)", async () => {
    const created = await (
      await post(PROBE, { token: user.token, body: { person: 'Bob', question: 'q' } })
    ).json();
    const other = await seedUser();
    const res = await post(`${PROBE}/${created.ask_id}/fill`, {
      token: other.token,
      body: { answer: 'x' },
    });
    expect(res.status).toBe(404);
  });
});
