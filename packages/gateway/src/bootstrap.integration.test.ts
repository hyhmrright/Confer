import { beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { backfillOwnerParticipants, rehostLegacyDids } from './bootstrap.js';
import { getDb } from './db/connection.js';
import {
  agents,
  conversationParticipants,
  conversations,
  keypairs,
  peerAgents,
  users,
} from './db/schema.js';
import { resetDb, seedUser } from './test/helpers.js';

beforeEach(resetDb);

// The test env leaves PUBLIC_HOST at its default, so the authority these
// identities should end up on is the percent-encoded `localhost:3000`.
const NEW_AUTHORITY = 'did:web:localhost%3A3000';

describe('rehostLegacyDids', () => {
  test('moves users, agents and their key ids off the hardcoded localhost', async () => {
    const db = getDb();
    const user = await seedUser('laowang'); // seeded with the legacy DID shape
    const agentId = newId();
    await db
      .insert(agents)
      .values({ id: agentId, user_id: user.id, did: `${user.did}:agent`, name: 'A' });
    const keyId = newId();
    await db.insert(keypairs).values({
      id: keyId,
      owner_type: 'user',
      owner_id: user.id,
      key_id: `${user.did}#key-1`,
      public_key_multibase: 'z6Mk',
      private_key_jwk_encrypted: {},
    });

    await rehostLegacyDids();

    const [movedUser] = await db.select().from(users).where(eq(users.id, user.id));
    const [movedAgent] = await db.select().from(agents).where(eq(agents.id, agentId));
    const [movedKey] = await db.select().from(keypairs).where(eq(keypairs.id, keyId));

    expect(movedUser?.did).toBe(`${NEW_AUTHORITY}:agents:laowang`);
    // The key id has to travel with the DID: inbound verification matches it
    // against the one in the request's Signature-Input.
    expect(movedAgent?.did).toBe(`${NEW_AUTHORITY}:agents:laowang:agent`);
    expect(movedKey?.key_id).toBe(`${NEW_AUTHORITY}:agents:laowang#key-1`);
  });

  test('leaves a host that merely starts with localhost alone', async () => {
    const db = getDb();
    const id = newId();
    await db
      .insert(users)
      .values({ id, username: 'other', did: 'did:web:localhost.dev:agents:other' });

    await rehostLegacyDids();

    const [row] = await db.select().from(users).where(eq(users.id, id));
    expect(row?.did).toBe('did:web:localhost.dev:agents:other');
  });

  test('does not rewrite peer_agents, which describe remote parties', async () => {
    const db = getDb();
    const id = newId();
    await db.insert(peerAgents).values({
      id,
      did: 'did:web:localhost:agents:someone-else',
      endpoint: 'http://localhost/a2a/v1',
      public_key_json: {},
      agent_facts_json: {},
    });

    await rehostLegacyDids();

    const [row] = await db.select().from(peerAgents).where(eq(peerAgents.id, id));
    expect(row?.did).toBe('did:web:localhost:agents:someone-else');
  });
});

describe('backfillOwnerParticipants', () => {
  async function seedOrphanedThread(ownerId: string): Promise<string> {
    const db = getDb();
    const convId = newId();
    const peerId = newId();
    await db.insert(peerAgents).values({
      id: peerId,
      did: `did:web:peer-${peerId.slice(-6).toLowerCase()}.example.com`,
      endpoint: 'https://peer.example.com/a2a/v1',
      public_key_json: {},
      agent_facts_json: {},
    });
    await db
      .insert(conversations)
      .values({ id: convId, type: 'direct_agent_agent', created_by: ownerId });
    // Only the peer — the shape inbound A2A produced before v0.3.1.
    await db.insert(conversationParticipants).values({
      id: newId(),
      conversation_id: convId,
      participant_type: 'peer_agent',
      peer_id: peerId,
      role: 'member',
    });
    return convId;
  }

  async function ownerRowsFor(convId: string): Promise<number> {
    const rows = await getDb()
      .select()
      .from(conversationParticipants)
      .where(eq(conversationParticipants.conversation_id, convId));
    return rows.filter((r) => r.participant_type === 'user').length;
  }

  // Without this row the owner's own agent answers in a thread that never
  // appears in their conversation list — the list is keyed on participation.
  test('adds the missing owner row and is idempotent', async () => {
    const user = await seedUser();
    const convId = await seedOrphanedThread(user.id);
    expect(await ownerRowsFor(convId)).toBe(0);

    await backfillOwnerParticipants();
    expect(await ownerRowsFor(convId)).toBe(1);

    await backfillOwnerParticipants();
    expect(await ownerRowsFor(convId)).toBe(1);
  });

  test('leaves a thread that already has its owner untouched', async () => {
    const db = getDb();
    const user = await seedUser();
    const convId = await seedOrphanedThread(user.id);
    await db.insert(conversationParticipants).values({
      id: newId(),
      conversation_id: convId,
      participant_type: 'user',
      user_id: user.id,
      role: 'owner',
    });

    await backfillOwnerParticipants();

    expect(await ownerRowsFor(convId)).toBe(1);
  });
});
