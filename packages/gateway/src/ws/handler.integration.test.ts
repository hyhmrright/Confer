import { beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { getDb } from '../db/connection.js';
import { peerAgents, peerContacts } from '../db/schema.js';
import { type SeededUser, resetDb, seedUser } from '../test/helpers.js';
import { getPresenceAudience } from './handler.js';

let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

// Record that `owner` added the agent identified by `targetDid` as a contact.
async function addContact(ownerId: string, targetDid: string): Promise<void> {
  const db = getDb();
  const peerId = newId();
  await db.insert(peerAgents).values({
    id: peerId,
    did: targetDid,
    endpoint: 'https://localhost/a2a/v1',
    public_key_json: {},
    agent_facts_json: {},
  });
  await db
    .insert(peerContacts)
    .values({ id: newId(), user_id: ownerId, peer_id: peerId, added_via: 'manual' });
}

describe('getPresenceAudience', () => {
  test('returns the users who added this user, not the ones this user added', async () => {
    const follower = await seedUser('follower');
    const followed = await seedUser('followed');

    // follower added `user`; `user` added `followed`.
    await addContact(follower.id, user.did);
    await addContact(user.id, followed.did);

    const audience = await getPresenceAudience(user.id);

    expect(audience).toEqual([follower.id]);
  });

  test('returns an empty list when nobody added this user', async () => {
    const followed = await seedUser('followed');
    await addContact(user.id, followed.did);

    expect(await getPresenceAudience(user.id)).toEqual([]);
  });
});
