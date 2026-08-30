import { beforeEach, describe, expect, test } from 'bun:test';
import { encrypt, newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { knowledgeBases, users } from '../db/schema.js';
import { getEnv } from '../env.js';
import { resetDb, type SeededUser, seedUser } from '../test/helpers.js';
import { resolveAgentCapabilities } from './llm-keys.js';

// The capability resolver reads an embedding key before it will report any
// knowledge base at all, so a user without one looks like a user without bases.
async function giveEmbeddingKey(userId: string): Promise<void> {
  const enc = await encrypt('sk-test-embedding', getEnv().ENCRYPTION_KEY);
  if (!enc.ok) throw new Error('failed to encrypt test key');
  await getDb()
    .update(users)
    .set({ llm_keys_json: { openai: enc.value } })
    .where(eq(users.id, userId));
}

async function makeKb(userId: string, name: string, shared: boolean): Promise<string> {
  const id = newId();
  await getDb()
    .insert(knowledgeBases)
    .values({ id, user_id: userId, name, shared_with_peers: shared });
  return id;
}

function env() {
  return { ENCRYPTION_KEY: getEnv().ENCRYPTION_KEY, TAVILY_API_KEY: '' };
}

async function keysOf(user: SeededUser): Promise<Record<string, unknown>> {
  const [row] = await getDb()
    .select({ keys: users.llm_keys_json })
    .from(users)
    .where(eq(users.id, user.id));
  return (row?.keys as Record<string, unknown>) ?? {};
}

let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
  await giveEmbeddingKey(user.id);
});

describe('resolveAgentCapabilities: what a peer-audience turn may reach', () => {
  test('an owner turn searches every knowledge base, a peer turn only the shared ones', async () => {
    await makeKb(user.id, 'private notes', false);
    const sharedId = await makeKb(user.id, 'public wiki', true);
    const keys = await keysOf(user);

    const owner = await resolveAgentCapabilities(user.id, keys, env(), 'owner');
    // undefined, not a list of every id: the owner's turn is unrestricted, and
    // conflating that with "restricted to everything" would quietly go stale
    // the moment a base is added mid-turn.
    expect(owner.kbScope).toBeUndefined();
    expect(owner.hasKb).toBe(true);

    const peer = await resolveAgentCapabilities(user.id, keys, env(), 'peer');
    expect(peer.kbScope).toEqual([sharedId]);
    expect(peer.hasKb).toBe(true);
  });

  // The dangerous shape. An empty scope must mean "nothing", and `searchChunks`
  // reads an absent kb_ids list as "everything" — so an owner who has shared
  // nothing must not come back with `undefined` here.
  test('a peer turn with no shared base gets an empty scope, never an absent one', async () => {
    await makeKb(user.id, 'private notes', false);
    await makeKb(user.id, 'also private', false);

    const peer = await resolveAgentCapabilities(user.id, await keysOf(user), env(), 'peer');

    expect(peer.kbScope).toEqual([]);
    expect(peer.kbScope).not.toBeUndefined();
    // …and the tool is not offered at all, so the model cannot even try.
    expect(peer.hasKb).toBe(false);
  });

  test('long-term memory is recalled for the owner and withheld from a peer', async () => {
    const keys = await keysOf(user);

    expect((await resolveAgentCapabilities(user.id, keys, env(), 'owner')).recallMemory).toBe(true);
    expect((await resolveAgentCapabilities(user.id, keys, env(), 'peer')).recallMemory).toBe(false);
  });

  test("one owner's shared base never widens another owner's peer scope", async () => {
    await makeKb(user.id, 'my private notes', false);

    const other = await seedUser();
    await giveEmbeddingKey(other.id);
    await makeKb(other.id, 'their shared wiki', true);

    const peer = await resolveAgentCapabilities(user.id, await keysOf(user), env(), 'peer');
    expect(peer.kbScope).toEqual([]);
  });
});
