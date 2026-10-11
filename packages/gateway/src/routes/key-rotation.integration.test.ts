import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { loadOwnerSigningKey } from '../a2a/signing.js';
import { app } from '../app.js';
import { getDb } from '../db/connection.js';
import { keypairs, users } from '../db/schema.js';
import { resolveDidDocument } from '../lib/did-resolution.js';
import { get, post, resetDb } from '../test/helpers.js';

beforeEach(resetDb);

// Through the real route: registration is what mints `#key-1`, and a fixture
// inventing a key row is how the owner-key bug once went unseen.
async function register() {
  const username = `k${Math.random().toString(36).slice(2, 10)}`;
  const res = await post('/api/v1/auth/register', {
    body: { username, password: 'correct horse battery', device_id: 'test-device' },
  });
  const body = await res.json();
  const [row] = await getDb().select().from(users).where(eq(users.username, username));
  if (!row) throw new Error('not registered');
  return { username, token: body.access_token as string, id: row.id, did: row.did };
}

const didDoc = async (username: string) =>
  (await app.request(`/agents/${username}/did.json`)).json() as Promise<{
    verificationMethod: Array<{ id: string }>;
    authentication: string[];
  }>;

const keyList = async (token: string) =>
  (await (await get('/api/v1/users/me/keys', { token })).json()).keys as Array<{
    key_id: string;
    status: string;
    retires_at: string | null;
  }>;

describe('key rotation', () => {
  test('a new account has one current key, published and used to sign', async () => {
    const me = await register();
    expect((await keyList(me.token)).map((k) => [k.key_id, k.status])).toEqual([
      [`${me.did}#key-1`, 'current'],
    ]);
    expect((await didDoc(me.username)).authentication).toEqual([`${me.did}#key-1`]);
  });

  // The old key stays in the document for the overlap, so a message signed with
  // it before the rotation still verifies; only the new one signs from now on.
  test('rotation signs with the new key and keeps the old one verifiable for 30 days', async () => {
    const me = await register();
    const res = await post('/api/v1/users/me/keys/rotate', { token: me.token, body: {} });
    expect(res.status).toBe(201);
    expect((await res.json()).key_id).toBe(`${me.did}#key-2`);

    const keys = await keyList(me.token);
    expect(keys.map((k) => [k.key_id, k.status])).toEqual([
      [`${me.did}#key-2`, 'current'],
      [`${me.did}#key-1`, 'retiring'],
    ]);
    const retires = new Date(keys[1]?.retires_at ?? 0).getTime();
    expect(Math.abs(retires - (Date.now() + 30 * 86_400_000))).toBeLessThan(60_000);

    const published = [`${me.did}#key-2`, `${me.did}#key-1`];
    expect((await didDoc(me.username)).authentication).toEqual(published);
    // Our own resolver answers from the database and must agree with the route.
    const local = await resolveDidDocument(me.did);
    expect(local.ok && local.value.authentication).toEqual(published);

    const signing = await loadOwnerSigningKey(me.id);
    expect(signing.ok && signing.value.keyId).toBe(`${me.did}#key-2`);
  });

  // A double click: the per-account lock runs the two one after the other, so
  // both land as distinct keys and exactly one is left signing.
  test('two rotations at once both land, and leave one current key', async () => {
    const me = await register();
    const [a, b] = await Promise.all(
      [0, 1].map(() => post('/api/v1/users/me/keys/rotate', { token: me.token, body: {} })),
    );
    expect([a?.status, b?.status]).toEqual([201, 201]);

    const keys = await keyList(me.token);
    expect(keys.filter((k) => k.status === 'current')).toHaveLength(1);
    expect(keys.map((k) => k.key_id).sort()).toEqual([1, 2, 3].map((n) => `${me.did}#key-${n}`));
  });

  test('says how long a verifier may cache the document', async () => {
    const me = await register();
    const res = await app.request(`/agents/${me.username}/did.json`);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
  });

  test('a retired key leaves the document once its overlap ends', async () => {
    const me = await register();
    await post('/api/v1/users/me/keys/rotate', { token: me.token, body: {} });
    await getDb()
      .update(keypairs)
      .set({ revoked_at: new Date(Date.now() - 1000) })
      .where(eq(keypairs.key_id, `${me.did}#key-1`));

    expect((await didDoc(me.username)).authentication).toEqual([`${me.did}#key-2`]);
    expect((await keyList(me.token))[1]?.status).toBe('revoked');
  });

  test('revoking takes a retiring key out at once, but never the one that signs', async () => {
    const me = await register();
    const revoke = (key_id: string) =>
      post('/api/v1/users/me/keys/revoke', { token: me.token, body: { key_id } });

    const inUse = await revoke(`${me.did}#key-1`);
    expect(inUse.status).toBe(409);
    expect((await inUse.json()).error.code).toBe('rotate_first');

    await post('/api/v1/users/me/keys/rotate', { token: me.token, body: {} });
    expect((await revoke(`${me.did}#key-1`)).status).toBe(200);
    expect((await didDoc(me.username)).authentication).toEqual([`${me.did}#key-2`]);
    expect((await revoke(`${me.did}#key-1`)).status).toBe(404);
  });

  test('only the person may rotate or revoke, never an API token', async () => {
    const me = await register();
    const minted = await post('/api/v1/tokens', { token: me.token, body: { name: 'ci' } });
    const token = (await minted.json()).token.token as string;

    const rotated = await post('/api/v1/users/me/keys/rotate', { token, body: {} });
    expect(rotated.status).toBe(403);
    expect((await get('/api/v1/users/me/keys', { token })).status).toBe(200);
  });
});
