import { beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { getDb } from '../db/connection.js';
import { peerAgents } from '../db/schema.js';
import { post, resetDb, type SeededUser, seedUser } from '../test/helpers.js';
import { listContacts, listKnowledgeBases } from './introspect.js';

// These two tools read owner-scoped data and hand it to a model, so what they
// must NOT return matters more than what they do. Both properties need real
// rows to mean anything — a unit test with no data passes whether or not the
// scoping works.

let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

async function createKb(name: string, token = user.token): Promise<string> {
  const res = await post('/api/v1/knowledge-bases', { token, body: { name } });
  expect(res.status).toBe(201);
  return (await res.json()).knowledge_base.id;
}

async function seedPeer(): Promise<string> {
  const id = newId();
  await getDb()
    .insert(peerAgents)
    .values({
      id,
      did: `did:web:peer-${id.slice(-6).toLowerCase()}.example.com`,
      name: 'Peer Bot',
      organization: 'Acme',
      endpoint: 'https://peer.example.com/a2a/v1',
      public_key_json: {},
      agent_facts_json: {},
    });
  return id;
}

describe('listKnowledgeBases', () => {
  test("lists the owner's bases when unscoped", async () => {
    await createKb('产品资料');
    await createKb('内部 wiki');

    const listed = await listKnowledgeBases(user.id);
    expect(listed).toContain('产品资料');
    expect(listed).toContain('内部 wiki');
  });

  test('omits a base outside the scope', async () => {
    const shared = await createKb('可共享');
    await createKb('私密');

    // The peer-audience case: the scope is the set marked shareable, and the
    // listing has to agree with what search_knowledge_base would allow. Listing
    // a base the search then refuses is worse than not listing it — the model
    // would keep aiming at a name that silently returns nothing.
    const listed = await listKnowledgeBases(user.id, [shared]);
    expect(listed).toContain('可共享');
    expect(listed).not.toContain('私密');
  });

  test('lists nothing for an empty scope, even with bases present', async () => {
    await createKb('私密');

    // Load-bearing only because a base exists: an empty scope must resolve to
    // "nothing", never to "everything".
    expect(await listKnowledgeBases(user.id, [])).not.toContain('私密');
  });

  test("never lists another account's bases", async () => {
    const outsider = await seedUser('outsider');
    await createKb('别人的资料', outsider.token);

    expect(await listKnowledgeBases(user.id)).not.toContain('别人的资料');
  });
});

describe('listContacts', () => {
  test('lists the contacts the owner added', async () => {
    const peerId = await seedPeer();
    await post('/api/v1/contacts', { token: user.token, body: { peer_id: peerId, alias: 'Bob' } });

    const listed = await listContacts(user.id);
    expect(listed).toContain('Bob');
    expect(listed).toContain('Acme');
  });

  test('does not leak a contact shared with another account', async () => {
    // The one that matters. `peer_agents` rows are globally unique by DID, so
    // two accounts that add the same peer share a single row and a single
    // peer_id — any query scoped by peer alone is not tenant-isolated, which
    // has produced a real cross-tenant leak in this codebase before.
    const peerId = await seedPeer();
    const outsider = await seedUser('outsider');
    await post('/api/v1/contacts', {
      token: outsider.token,
      body: { peer_id: peerId, alias: 'OutsiderAlias' },
    });

    const listed = await listContacts(user.id);
    expect(listed).not.toContain('OutsiderAlias');
    expect(listed).toBe('还没有已连接的联系人。');
  });
});
