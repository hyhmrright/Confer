import { beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { getDb } from '../db/connection.js';
import { peerAgents, peerContacts } from '../db/schema.js';
import { type SeededUser, get, put, resetDb, seedUser } from '../test/helpers.js';

const PROJECTS = '/api/v1/projects';
const PROJECT = 'confer';

let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

// Seed a peer_agent and (optionally) connect it as a contact of the given user.
// Returns the peer row id.
async function seedPeer(opts: { contactOf?: string; name?: string; did?: string } = {}) {
  const db = getDb();
  const peerId = newId();
  await db.insert(peerAgents).values({
    id: peerId,
    did: opts.did ?? `did:web:localhost:${peerId.slice(-6).toLowerCase()}`,
    name: opts.name ?? 'Peer One',
    endpoint: 'https://peer.example/a2a/v1',
    public_key_json: {},
    agent_facts_json: {},
  });
  if (opts.contactOf) {
    await db
      .insert(peerContacts)
      .values({ id: newId(), user_id: opts.contactOf, peer_id: peerId, added_via: 'manual' });
  }
  return peerId;
}

describe('projects memory', () => {
  test('requires authentication', async () => {
    const res = await get(`${PROJECTS}/${PROJECT}/peers`);
    expect(res.status).toBe(401);
  });

  test('write then read back returns same content with version 1', async () => {
    const peerId = await seedPeer({ contactOf: user.id });
    const wrote = await put(`${PROJECTS}/${PROJECT}/peers/${peerId}/facts`, {
      token: user.token,
      body: { facts_md: 'uses ULID for ids' },
    });
    expect(wrote.status).toBe(200);
    expect((await wrote.json()).version).toBe(1);

    const read = await get(`${PROJECTS}/${PROJECT}/peers/${peerId}/facts`, { token: user.token });
    const body = await read.json();
    expect(body.facts_md).toBe('uses ULID for ids');
    expect(body.version).toBe(1);
  });

  test('second write increments version and refreshes updated_at', async () => {
    const peerId = await seedPeer({ contactOf: user.id });
    const first = await put(`${PROJECTS}/${PROJECT}/peers/${peerId}/facts`, {
      token: user.token,
      body: { facts_md: 'v1' },
    });
    const firstTs = (await first.json()).updated_at;

    const second = await put(`${PROJECTS}/${PROJECT}/peers/${peerId}/facts`, {
      token: user.token,
      body: { facts_md: 'v2' },
    });
    const secondBody = await second.json();
    expect(secondBody.version).toBe(2);
    expect(secondBody.facts_md).toBe('v2');
    expect(secondBody.updated_at).not.toBe(firstTs);
  });

  test('facts and decisions are independent — neither write clears the other', async () => {
    const peerId = await seedPeer({ contactOf: user.id });
    await put(`${PROJECTS}/${PROJECT}/peers/${peerId}/facts`, {
      token: user.token,
      body: { facts_md: 'the facts' },
    });
    await put(`${PROJECTS}/${PROJECT}/peers/${peerId}/decisions`, {
      token: user.token,
      body: { decisions_md: 'the decisions' },
    });

    const facts = await (
      await get(`${PROJECTS}/${PROJECT}/peers/${peerId}/facts`, { token: user.token })
    ).json();
    const decisions = await (
      await get(`${PROJECTS}/${PROJECT}/peers/${peerId}/decisions`, { token: user.token })
    ).json();
    expect(facts.facts_md).toBe('the facts');
    expect(decisions.decisions_md).toBe('the decisions');
  });

  test('missing memory reads as empty (200) rather than 404', async () => {
    const peerId = await seedPeer({ contactOf: user.id });
    const res = await get(`${PROJECTS}/${PROJECT}/peers/${peerId}/facts`, { token: user.token });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.facts_md).toBe('');
    expect(body.version).toBe(0);
  });

  test('memory is isolated per user', async () => {
    const userB = await seedUser();
    // Same peer is a contact of both users.
    const peerId = await seedPeer({ contactOf: user.id });
    await getDb()
      .insert(peerContacts)
      .values({ id: newId(), user_id: userB.id, peer_id: peerId, added_via: 'manual' });

    await put(`${PROJECTS}/${PROJECT}/peers/${peerId}/facts`, {
      token: user.token,
      body: { facts_md: "A's private facts" },
    });

    // B reads the same project_id+peer_id and sees an empty memory, not A's row.
    const bRead = await get(`${PROJECTS}/${PROJECT}/peers/${peerId}/facts`, { token: userB.token });
    expect((await bRead.json()).facts_md).toBe('');

    // B's own write starts at version 1 and does not touch A's row.
    const bWrote = await put(`${PROJECTS}/${PROJECT}/peers/${peerId}/facts`, {
      token: userB.token,
      body: { facts_md: "B's facts" },
    });
    expect((await bWrote.json()).version).toBe(1);
    const aRead = await get(`${PROJECTS}/${PROJECT}/peers/${peerId}/facts`, { token: user.token });
    expect((await aRead.json()).facts_md).toBe("A's private facts");
  });

  test('writing memory for a non-contact peer returns 403', async () => {
    const peerId = await seedPeer(); // peer exists but is not a contact
    const res = await put(`${PROJECTS}/${PROJECT}/peers/${peerId}/facts`, {
      token: user.token,
      body: { facts_md: 'x' },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('not_a_contact');
  });

  test('GET peers lists peers with joined name/did; empty project returns empty array', async () => {
    const empty = await get(`${PROJECTS}/empty-project/peers`, { token: user.token });
    expect((await empty.json()).peers).toEqual([]);

    const peerA = await seedPeer({
      contactOf: user.id,
      name: 'Alpha',
      did: 'did:web:localhost:aaa',
    });
    const peerB = await seedPeer({
      contactOf: user.id,
      name: 'Beta',
      did: 'did:web:localhost:bbb',
    });
    await put(`${PROJECTS}/${PROJECT}/peers/${peerA}/facts`, {
      token: user.token,
      body: { facts_md: 'a' },
    });
    await put(`${PROJECTS}/${PROJECT}/peers/${peerB}/decisions`, {
      token: user.token,
      body: { decisions_md: 'b' },
    });

    const res = await get(`${PROJECTS}/${PROJECT}/peers`, { token: user.token });
    const peers = (await res.json()).peers as Array<{ peer_id: string; name: string; did: string }>;
    expect(peers).toHaveLength(2);
    const byId = new Map(peers.map((p) => [p.peer_id, p]));
    expect(byId.get(peerA)?.name).toBe('Alpha');
    expect(byId.get(peerA)?.did).toBe('did:web:localhost:aaa');
    expect(byId.get(peerB)?.name).toBe('Beta');
  });

  test('illegal project_id returns 400', async () => {
    const peerId = await seedPeer({ contactOf: user.id });
    const res = await put(`${PROJECTS}/${encodeURIComponent('has space')}/peers/${peerId}/facts`, {
      token: user.token,
      body: { facts_md: 'x' },
    });
    expect(res.status).toBe(400);
  });
});
