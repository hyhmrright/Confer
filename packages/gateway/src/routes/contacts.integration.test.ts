import { beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { agents, peerAgents } from '../db/schema.js';
import {
  type SeededUser,
  del,
  get,
  mockFetch,
  patch,
  post,
  resetDb,
  seedUser,
} from '../test/helpers.js';

const BASE = '/api/v1/contacts';
let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

async function seedPeer(): Promise<string> {
  const id = newId();
  await getDb()
    .insert(peerAgents)
    .values({
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
    const res = await post(BASE, {
      token: user.token,
      body: { peer_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ' },
    });
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

  test('domain lookup persists only DIDs bound to the queried host (anti-poisoning)', async () => {
    const restore = mockFetch((url) => {
      if (url.includes('/.well-known/agents.json')) {
        return Response.json({
          agents: [
            { did: 'did:web:vendor.example.com', name: 'Legit' },
            { did: 'did:web:vendor.example.com:agents:bot', name: 'Legit sub' },
            { did: 'did:web:trusted-bank.com', name: 'Spoofed cross-host' },
          ],
        });
      }
      return undefined;
    });
    try {
      const res = await post(`${BASE}/lookup`, {
        token: user.token,
        body: { method: 'domain', value: 'vendor.example.com' },
      });
      const { candidates } = await res.json();
      expect(candidates.map((c: { did: string }) => c.did).sort()).toEqual([
        'did:web:vendor.example.com',
        'did:web:vendor.example.com:agents:bot',
      ]);

      // The spoofed cross-host DID must never be persisted.
      const poisoned = await getDb()
        .select()
        .from(peerAgents)
        .where(eq(peerAgents.did, 'did:web:trusted-bank.com'));
      expect(poisoned).toHaveLength(0);
    } finally {
      restore();
    }
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

// Add `peerId` as a contact of `token`'s user and return the new contact id.
async function addContact(token: string, peerId: string, alias?: string): Promise<string> {
  const res = await post(BASE, { token, body: { peer_id: peerId, alias } });
  return (await res.json()).contact.id;
}

describe('contact detail + metadata + policies', () => {
  test('GET /:id reads back a single contact with its peer', async () => {
    const peerId = await seedPeer();
    const contactId = await addContact(user.token, peerId, 'Bob');

    const res = await get(`${BASE}/${contactId}`, { token: user.token });
    expect(res.status).toBe(200);
    const { contact } = await res.json();
    expect(contact.id).toBe(contactId);
    expect(contact.alias).toBe('Bob');
    expect(contact.peer.id).toBe(peerId);
  });

  test('GET /:id returns 404 for a missing id', async () => {
    const res = await get(`${BASE}/01HZZZZZZZZZZZZZZZZZZZZZZZ`, { token: user.token });
    expect(res.status).toBe(404);
  });

  test('PATCH /:id updates only the supplied fields (pinned toggle keeps alias)', async () => {
    const peerId = await seedPeer();
    const contactId = await addContact(user.token, peerId, 'Bob');

    const res = await patch(`${BASE}/${contactId}`, {
      token: user.token,
      body: { pinned: true, tags: ['work'] },
    });
    expect(res.status).toBe(200);
    const { contact } = await res.json();
    expect(contact.pinned).toBe(true);
    expect(contact.tags).toEqual(['work']);
    // The unsent alias is untouched, not cleared.
    expect(contact.alias).toBe('Bob');

    // muting next leaves pinned/alias/tags intact.
    const res2 = await patch(`${BASE}/${contactId}`, {
      token: user.token,
      body: { muted: true },
    });
    const { contact: c2 } = await res2.json();
    expect(c2.muted).toBe(true);
    expect(c2.pinned).toBe(true);
    expect(c2.alias).toBe('Bob');
    expect(c2.tags).toEqual(['work']);
  });

  test('PATCH /:id with alias:null clears the alias', async () => {
    const peerId = await seedPeer();
    const contactId = await addContact(user.token, peerId, 'Bob');

    const res = await patch(`${BASE}/${contactId}`, {
      token: user.token,
      body: { alias: null },
    });
    expect(res.status).toBe(200);
    const { contact } = await res.json();
    // Explicit null clears the column (not coerced to undefined and dropped).
    expect(contact.alias).toBeNull();
  });

  test('PATCH /:id returns 404 for a missing id', async () => {
    const res = await patch(`${BASE}/01HZZZZZZZZZZZZZZZZZZZZZZZ`, {
      token: user.token,
      body: { pinned: true },
    });
    expect(res.status).toBe(404);
  });

  test('POST /:id/policies writes the override and GET /:id reflects it', async () => {
    const peerId = await seedPeer();
    const contactId = await addContact(user.token, peerId);

    const overrides = {
      default: 'ask_user',
      rules: [{ action: 'ask', peer_did: 'did:web:peer.example.com', decision: 'deny' }],
    };
    const written = await post(`${BASE}/${contactId}/policies`, {
      token: user.token,
      body: overrides,
    });
    expect(written.status).toBe(200);

    const res = await get(`${BASE}/${contactId}`, { token: user.token });
    const { contact } = await res.json();
    expect(contact.policy_overrides_json).toEqual(overrides);
  });

  test('POST /:id/policies rejects a malformed override body with 400', async () => {
    const peerId = await seedPeer();
    const contactId = await addContact(user.token, peerId);

    const res = await post(`${BASE}/${contactId}/policies`, {
      token: user.token,
      body: { default: 'maybe' },
    });
    expect(res.status).toBe(400);
  });

  test('POST /:id/policies returns 404 for a missing id', async () => {
    const res = await post(`${BASE}/01HZZZZZZZZZZZZZZZZZZZZZZZ/policies`, {
      token: user.token,
      body: { default: 'ask_user' },
    });
    expect(res.status).toBe(404);
  });

  test("the three endpoints 404 on another user's contact (no existence leak)", async () => {
    const peerId = await seedPeer();
    const contactId = await addContact(user.token, peerId, 'Mine');

    const other = await seedUser();
    expect((await get(`${BASE}/${contactId}`, { token: other.token })).status).toBe(404);
    expect(
      (await patch(`${BASE}/${contactId}`, { token: other.token, body: { pinned: true } })).status,
    ).toBe(404);
    expect(
      (
        await post(`${BASE}/${contactId}/policies`, {
          token: other.token,
          body: { default: 'deny' },
        })
      ).status,
    ).toBe(404);

    // The owner's contact is untouched by the rejected cross-user writes.
    const mine = await get(`${BASE}/${contactId}`, { token: user.token });
    const { contact } = await mine.json();
    expect(contact.pinned).not.toBe(true);
    expect(contact.alias).toBe('Mine');
  });
});
