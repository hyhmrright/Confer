import { newId } from '@confer/shared';
import { beforeEach, describe, expect, test } from 'bun:test';
import { getDb } from '../db/connection.js';
import { conversationParticipants, conversations, messages } from '../db/schema.js';
import { type SeededUser, get, resetDb, seedUser } from '../test/helpers.js';

let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

async function seedConversation(createdBy: string): Promise<string> {
  const id = newId();
  await getDb().insert(conversations).values({ id, type: 'direct_user_agent', created_by: createdBy });
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
