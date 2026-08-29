import { beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { getDb } from '../db/connection.js';
import { conversationParticipants } from '../db/schema.js';
import { del, get, post, resetDb, type SeededUser, seedUser } from '../test/helpers.js';

const BASE = '/api/v1/conversations';
let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

async function createConversation(token: string): Promise<string> {
  const res = await post(BASE, { token, body: { type: 'direct_user_agent', name: 'Chat' } });
  expect(res.status).toBe(201);
  return (await res.json()).conversation.id;
}

describe('conversations', () => {
  test('requires authentication', async () => {
    expect((await get(BASE)).status).toBe(401);
  });

  test('creates a conversation with the creator as participant and lists it', async () => {
    const id = await createConversation(user.token);

    const listed = await get(BASE, { token: user.token });
    const { conversations } = await listed.json();
    expect(conversations).toHaveLength(1);
    expect(conversations[0].id).toBe(id);
  });

  test('fetches a conversation by id and 404s for unknown ids', async () => {
    const id = await createConversation(user.token);
    expect((await get(`${BASE}/${id}`, { token: user.token })).status).toBe(200);
    expect((await get(`${BASE}/01HZZZZZZZZZZZZZZZZZZZZZZZ`, { token: user.token })).status).toBe(
      404,
    );
  });

  test('posts a message and reads it back', async () => {
    const id = await createConversation(user.token);
    const sent = await post(`${BASE}/${id}/messages`, {
      token: user.token,
      body: { content: 'hello there' },
    });
    expect(sent.status).toBe(201);
    const body = await sent.json();
    expect(body.delivery_status).toBe('queued');
    expect(body.stream_url).toContain(id);

    const msgs = await get(`${BASE}/${id}/messages`, { token: user.token });
    const { messages } = await msgs.json();
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('hello there');
  });

  // Paging was untested, and it paged by id while ordering by created_at —
  // two different keys, which disagreed whenever rows landed in the same
  // millisecond and let a page skip a message or repeat one. Both are the id
  // now, and `newId` is monotonic so it is exact insertion order.
  test('a cursor pages back through what came before it, without gaps', async () => {
    const id = await createConversation(user.token);
    const sent: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await post(`${BASE}/${id}/messages`, {
        token: user.token,
        body: { content: `m-${i}` },
      });
      sent.push((await res.json()).id);
    }

    const first = await get(`${BASE}/${id}/messages?limit=2`, { token: user.token });
    const page1 = (await first.json()).messages as Array<{ id: string; content: string }>;
    expect(page1.map((m) => m.content)).toEqual(['m-3', 'm-4']);

    const second = await get(`${BASE}/${id}/messages?limit=2&before=${page1[0]?.id}`, {
      token: user.token,
    });
    const page2 = (await second.json()).messages as Array<{ content: string }>;
    expect(page2.map((m) => m.content)).toEqual(['m-1', 'm-2']);
    expect(sent).toHaveLength(5);
  });

  test('rejects an empty message body with 400', async () => {
    const id = await createConversation(user.token);
    const res = await post(`${BASE}/${id}/messages`, { token: user.token, body: { content: '' } });
    expect(res.status).toBe(400);
  });

  test('only a participant may post a message', async () => {
    const id = await createConversation(user.token);
    const outsider = await seedUser();
    const res = await post(`${BASE}/${id}/messages`, {
      token: outsider.token,
      body: { content: 'intruder' },
    });
    expect(res.status).toBe(403);
  });

  test('only a participant may read messages', async () => {
    const id = await createConversation(user.token);
    const outsider = await seedUser();
    const res = await get(`${BASE}/${id}/messages`, { token: outsider.token });
    expect(res.status).toBe(403);
  });

  test('only the creator may delete a conversation, not a mere participant', async () => {
    const id = await createConversation(user.token);

    // A non-creator participant must not be able to destroy a shared thread.
    const participant = await seedUser();
    await getDb().insert(conversationParticipants).values({
      id: newId(),
      conversation_id: id,
      participant_type: 'user',
      user_id: participant.id,
    });
    expect((await del(`${BASE}/${id}`, { token: participant.token })).status).toBe(404);

    // An unrelated outsider is likewise refused (404 — existence not leaked).
    const outsider = await seedUser();
    expect((await del(`${BASE}/${id}`, { token: outsider.token })).status).toBe(404);

    // The conversation still exists and its creator can delete it.
    expect((await del(`${BASE}/${id}`, { token: user.token })).status).toBe(200);
  });

  test('scopes the conversation list to participants', async () => {
    await createConversation(user.token);
    const outsider = await seedUser();
    const res = await get(BASE, { token: outsider.token });
    expect((await res.json()).conversations).toHaveLength(0);
  });

  // `type` went into a varchar(32) unchecked, so a caller picked the value that
  // decides how the thread is rendered and which paths treat it as an A2A or
  // probe thread; an over-long `name` was a 500 rather than a 400.
  test('rejects a conversation type outside the vocabulary with 400', async () => {
    const res = await post(BASE, { token: user.token, body: { type: 'probe' } });
    expect(res.status).toBe(400);
  });

  test('rejects a name longer than the column with 400', async () => {
    const res = await post(BASE, { token: user.token, body: { name: 'x'.repeat(256) } });
    expect(res.status).toBe(400);
  });

  test('defaults the type when none is given', async () => {
    const res = await post(BASE, { token: user.token, body: {} });
    expect(res.status).toBe(201);
    expect((await res.json()).conversation.type).toBe('direct_user_agent');
  });
});
