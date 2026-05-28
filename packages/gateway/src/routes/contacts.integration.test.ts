import { newId } from '@confer/shared';
import { beforeEach, describe, expect, test } from 'bun:test';
import { getDb } from '../db/connection.js';
import { agents, peerAgents } from '../db/schema.js';
import { type SeededUser, del, get, post, resetDb, seedUser } from '../test/helpers.js';

const BASE = '/api/v1/contacts';
let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

async function seedPeer(): Promise<string> {
  const id = newId();
  await getDb().insert(peerAgents).values({
    id,
    did: `did:web:peer-${id.slice(-6).toLowerCase()}.example.com`,
    endpoint: 'https://peer.example.com/a2a/v1',
    public_key_json: {},
    agent_facts_json: {},
  });
  return id;
}

describe('contacts', () => {
  test('requires authentication', async () => {
    expect((await get(BASE)).status).toBe(401);
  });

  test('lists no contacts initially', async () => {
    const res = await get(BASE, { token: user.token });
    expect((await res.json()).contacts).toEqual([]);
  });

  test('adds a peer as a contact, lists it, then removes it', async () => {
    const peerId = await seedPeer();

    const added = await post(BASE, { token: user.token, body: { peer_id: peerId, alias: 'Bob' } });
    expect(added.status).toBe(201);
    const contactId = (await added.json()).contact.id;

    const listed = await get(BASE, { token: user.token });
    const { contacts } = await listed.json();
    expect(contacts).toHaveLength(1);
    expect(contacts[0].alias).toBe('Bob');
    expect(contacts[0].peer.id).toBe(peerId);

    expect((await del(`${BASE}/${contactId}`, { token: user.token })).status).toBe(200);
    expect((await del(`${BASE}/${contactId}`, { token: user.token })).status).toBe(404);
  });

  test('returns 404 when adding an unknown peer', async () => {
    const res = await post(BASE, { token: user.token, body: { peer_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ' } });
    expect(res.status).toBe(404);
  });

  test('rejects adding a contact without a peer_id with 400', async () => {
    const res = await post(BASE, { token: user.token, body: { alias: 'no-peer' } });
    expect(res.status).toBe(400);
  });

  test('looks up public agents by username', async () => {
    await getDb().insert(agents).values({
      id: newId(),
      user_id: user.id,
      did: 'did:web:localhost:agents:findme',
      name: 'Findable',
      is_public: true,
    });

    const res = await post(`${BASE}/lookup`, {
      token: user.token,
      body: { method: 'username', value: 'findme' },
    });
    expect(res.status).toBe(200);
    const { candidates } = await res.json();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].did).toBe('did:web:localhost:agents:findme');
  });

  test('blocks domain lookups against private addresses (SSRF guard)', async () => {
    const res = await post(`${BASE}/lookup`, {
      token: user.token,
      body: { method: 'domain', value: 'localhost' },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.candidates).toEqual([]);
    expect(json.error).toBe('Private addresses not allowed');
  });
});
