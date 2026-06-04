import { beforeEach, describe, expect, test } from 'bun:test';
import { type SeededUser, del, get, post, resetDb, seedUser } from '../test/helpers.js';

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

  test('only a participant may delete a conversation', async () => {
    const id = await createConversation(user.token);
    const outsider = await seedUser();

    expect((await del(`${BASE}/${id}`, { token: outsider.token })).status).toBe(403);
    expect((await del(`${BASE}/${id}`, { token: user.token })).status).toBe(200);
  });

  test('scopes the conversation list to participants', async () => {
    await createConversation(user.token);
    const outsider = await seedUser();
    const res = await get(BASE, { token: outsider.token });
    expect((await res.json()).conversations).toHaveLength(0);
  });
});
