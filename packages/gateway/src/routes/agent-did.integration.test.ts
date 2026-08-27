import { beforeEach, describe, expect, test } from 'bun:test';
import { generateEd25519KeyPair, publicKeyToMultibase } from '@confer/identity';
import { newId } from '@confer/shared';
import { getDb } from '../db/connection.js';
import { keypairs } from '../db/schema.js';
import { get, resetDb, seedUser } from '../test/helpers.js';

beforeEach(resetDb);

// A sentinel we scan the response body for — the private material must never
// appear in the served DID document.
const PRIVATE_SENTINEL = 'private-key-must-not-leak';

async function seedUserKeypair(ownerId: string, keyId: string): Promise<string> {
  const kp = await generateEd25519KeyPair();
  const multibase = await publicKeyToMultibase(kp.publicKey);
  await getDb()
    .insert(keypairs)
    .values({
      id: newId(),
      owner_type: 'user',
      owner_id: ownerId,
      key_id: keyId,
      public_key_multibase: multibase,
      private_key_jwk_encrypted: { d: PRIVATE_SENTINEL },
      is_active: true,
    });
  return multibase;
}

describe('GET /agents/:username/did.json', () => {
  test('serves the user DID document with only public key material', async () => {
    const user = await seedUser('laowang');
    const keyId = `${user.did}#key-1`;
    const multibase = await seedUserKeypair(user.id, keyId);

    const res = await get(`/agents/${user.username}/did.json`);
    expect(res.status).toBe(200);
    const doc = await res.json();

    expect(doc.id).toBe(user.did);
    // From PUBLIC_HOST, not the request Host header — a peer that resolved this
    // document must be handed the address the instance actually answers on.
    expect(doc.service[0].serviceEndpoint).toBe('http://localhost:3000/a2a/v1');
    expect(doc['@context']).toContain('https://www.w3.org/ns/did/v1');
    expect(doc.verificationMethod).toHaveLength(1);
    // Load-bearing: the id must be the STORED key_id verbatim so inbound
    // signature verification (vm.id === keyId) matches.
    expect(doc.verificationMethod[0].id).toBe(keyId);
    expect(doc.verificationMethod[0].publicKeyMultibase).toBe(multibase);
    expect(doc.authentication).toEqual([keyId]);

    // No private-key material anywhere in the response body.
    const raw = JSON.stringify(doc);
    expect(raw).not.toContain(PRIVATE_SENTINEL);
    expect(raw).not.toContain('private_key');
    expect(raw.toLowerCase()).not.toContain('encrypted');
  });

  test('returns 404 for an unknown username', async () => {
    const res = await get('/agents/nobody/did.json');
    expect(res.status).toBe(404);
  });

  test('serves a keyless document (200) when the user has no active keypair', async () => {
    const user = await seedUser('nokeys');

    const res = await get(`/agents/${user.username}/did.json`);
    expect(res.status).toBe(200);
    const doc = await res.json();

    expect(doc.id).toBe(user.did);
    expect(doc.verificationMethod).toEqual([]);
    expect(doc.authentication).toEqual([]);
    // The service endpoint is still advertised during a key-rotation gap.
    expect(doc.service?.[0]?.type).toBe('ConferAgent');
  });

  test('ignores a revoked (inactive) keypair', async () => {
    const user = await seedUser('rotated');
    const kp = await generateEd25519KeyPair();
    await getDb()
      .insert(keypairs)
      .values({
        id: newId(),
        owner_type: 'user',
        owner_id: user.id,
        key_id: `${user.did}#key-0`,
        public_key_multibase: await publicKeyToMultibase(kp.publicKey),
        private_key_jwk_encrypted: {},
        is_active: false,
      });

    const res = await get(`/agents/${user.username}/did.json`);
    const doc = await res.json();
    expect(doc.verificationMethod).toEqual([]);
  });
});
