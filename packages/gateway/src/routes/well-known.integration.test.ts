import { beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { getDb } from '../db/connection.js';
import { agents, keypairs } from '../db/schema.js';
import { get, resetDb, seedUser } from '../test/helpers.js';

beforeEach(resetDb);

describe('GET /.well-known/did.json', () => {
  test('serves a did:web document for the host', async () => {
    const res = await get('/.well-known/did.json');
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.id).toBe('did:web:localhost');
    expect(doc['@context']).toContain('https://www.w3.org/ns/did/v1');
    expect(doc.verificationMethod).toEqual([]); // no instance key seeded yet
  });

  test('includes the active instance verification method when present', async () => {
    await getDb().insert(keypairs).values({
      id: newId(),
      owner_type: 'instance',
      owner_id: 'system',
      key_id: 'did:web:localhost#key-1',
      public_key_multibase: 'z6MkInstanceKey',
      private_key_jwk_encrypted: {},
    });

    const res = await get('/.well-known/did.json');
    const doc = await res.json();
    expect(doc.verificationMethod).toHaveLength(1);
    expect(doc.verificationMethod[0]).toMatchObject({
      type: 'Ed25519VerificationKey2020',
      publicKeyMultibase: 'z6MkInstanceKey',
    });
  });
});

describe('GET /.well-known/agents.json', () => {
  test('lists only public agents', async () => {
    const user = await seedUser();
    await getDb()
      .insert(agents)
      .values([
        {
          id: newId(),
          user_id: user.id,
          did: 'did:web:localhost:agents:pub',
          name: 'Public',
          is_public: true,
        },
        {
          id: newId(),
          user_id: user.id,
          did: 'did:web:localhost:agents:priv',
          name: 'Private',
          is_public: false,
        },
      ]);

    const res = await get('/.well-known/agents.json');
    const { agents: listed } = await res.json();
    expect(listed).toHaveLength(1);
    expect(listed[0].did).toBe('did:web:localhost:agents:pub');
  });
});
