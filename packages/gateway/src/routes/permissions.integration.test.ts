import { beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { peerAgents, peerContacts, permissions } from '../db/schema.js';
import { get, post, resetDb, type SeededUser, seedUser } from '../test/helpers.js';

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

  // `scope_json` is JSONB: the column will happily hold an array or a scalar.
  // One such row must not be able to take down the whole approval inbox — the
  // owner would see an empty list, silently, and be unable to approve anything.
  test('a malformed scope_json degrades that one row instead of failing the list', async () => {
    await seedPending(user.id);
    const odd = newId();
    await getDb()
      .insert(permissions)
      .values({
        id: odd,
        user_id: user.id,
        action: 'connect',
        scope_json: ['not', 'an', 'object'],
        level: 'L2',
      });

    const res = await get('/api/v1/permissions/pending', { token: user.token });
    expect(res.status).toBe(200);
    const list = (await res.json()).permissions as Array<{ id: string; scope: unknown }>;
    expect(list).toHaveLength(2);
    expect(list.find((p) => p.id === odd)?.scope).toEqual({});
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

    expect(
      (await (await get('/api/v1/permissions/pending', { token: user.token })).json()).permissions,
    ).toHaveLength(0);
    expect(
      (await (await get('/api/v1/permissions/history', { token: user.token })).json()).permissions,
    ).toHaveLength(1);
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
    await getDb()
      .insert(permissions)
      .values({
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
    // Structured facts only — no server-rendered sentence. The wording the owner
    // reads is composed client-side through i18n, so the payload must carry the
    // raw inputs (action + peer identity + stored scope) and nothing pre-worded.
    expect(list[0].action).toBe('connect');
    expect(list[0].scope).toEqual({ first_message: 'hi there' });
    expect(list[0].peer_did).toBe('did:web:peer.example.com');
    expect(list[0].peer_name).toBe('Vendor Bot');
    expect(list[0].description).toBeUndefined();

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
