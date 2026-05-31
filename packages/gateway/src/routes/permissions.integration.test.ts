import { newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'bun:test';
import { getDb } from '../db/connection.js';
import { peerAgents, peerContacts, permissions } from '../db/schema.js';
import { type SeededUser, get, post, resetDb, seedUser } from '../test/helpers.js';

let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

async function seedPending(userId: string): Promise<string> {
  const id = newId();
  await getDb().insert(permissions).values({
    id,
    user_id: userId,
    action: 'send_message',
    scope_json: {},
    level: 'L2',
  });
  return id;
}

describe('permissions', () => {
  test('requires authentication', async () => {
    expect((await get('/api/v1/permissions/pending')).status).toBe(401);
  });

  test('lists pending requests, then moves them to history once decided', async () => {
    const id = await seedPending(user.id);

    const pending = await get('/api/v1/permissions/pending', { token: user.token });
    expect((await pending.json()).permissions).toHaveLength(1);

    const decided = await post(`/api/v1/permissions/${id}/decide`, {
      token: user.token,
      body: { decision: 'allow_once', scope: 'peer' },
    });
    expect(decided.status).toBe(200);

    expect((await (await get('/api/v1/permissions/pending', { token: user.token })).json()).permissions).toHaveLength(0);
    expect((await (await get('/api/v1/permissions/history', { token: user.token })).json()).permissions).toHaveLength(1);
  });

  test('returns 404 deciding an unknown request', async () => {
    const res = await post('/api/v1/permissions/01HZZZZZZZZZZZZZZZZZZZZZZZ/decide', {
      token: user.token,
      body: { decision: 'deny', scope: 'global' },
    });
    expect(res.status).toBe(404);
  });

  test('scopes pending requests to their owner', async () => {
    await seedPending(user.id);
    const other = await seedUser();
    const res = await get('/api/v1/permissions/pending', { token: other.token });
    expect((await res.json()).permissions).toHaveLength(0);
  });

  test('approving a connection request establishes the contact', async () => {
    const peerId = newId();
    await getDb().insert(peerAgents).values({
      id: peerId,
      did: 'did:web:peer.example.com',
      name: 'Vendor Bot',
      endpoint: 'https://peer.example.com/a2a/v1',
      public_key_json: {},
      agent_facts_json: {},
    });
    const reqId = newId();
    await getDb().insert(permissions).values({
      id: reqId,
      user_id: user.id,
      peer_id: peerId,
      action: 'connect',
      scope_json: { first_message: 'hi there' },
      level: 'L2',
      decision: 'pending',
      requested_by: peerId,
    });

    const pending = await get('/api/v1/permissions/pending', { token: user.token });
    const list = (await pending.json()).permissions;
    expect(list).toHaveLength(1);
    expect(list[0].description).toContain('建立连接');

    const decided = await post(`/api/v1/permissions/${reqId}/decide`, {
      token: user.token,
      body: { decision: 'allow_always', scope: 'peer' },
    });
    expect(decided.status).toBe(200);

    const contacts = await getDb()
      .select()
      .from(peerContacts)
      .where(eq(peerContacts.user_id, user.id));
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.peer_id).toBe(peerId);
  });
});
