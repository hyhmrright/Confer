import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  clearDIDCache,
  generateEd25519KeyPair,
  publicKeyToMultibase,
  signRequest,
} from '@confer/identity';
import { newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { app } from '../app.js';
import { getDb } from '../db/connection.js';
import { agents, messages, peerAgents, peerContacts, permissions } from '../db/schema.js';
import { type SeededUser, headers, mockFetch, resetDb, seedUser } from '../test/helpers.js';

const MESSAGES = 'http://localhost/a2a/v1/messages';
let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

async function seedTargetAgent(did: string): Promise<void> {
  await getDb().insert(agents).values({ id: newId(), user_id: user.id, did, policies_json: {} });
}

// Make `did` a connected contact of the seeded user so the consent gate lets
// its messages through to the agent loop.
async function connectPeer(did: string): Promise<void> {
  const db = getDb();
  const peerId = newId();
  await db.insert(peerAgents).values({
    id: peerId,
    did,
    endpoint: 'https://localhost/a2a/v1',
    public_key_json: {},
    agent_facts_json: {},
  });
  await db
    .insert(peerContacts)
    .values({ id: newId(), user_id: user.id, peer_id: peerId, added_via: 'manual' });
}

describe('A2A signature rejection', () => {
  test('rejects a request with no Signature header (401)', async () => {
    const res = await app.request('/a2a/v1/messages', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        from: 'did:web:peer',
        to: 'did:web:x',
        message: { type: 'question', content: 'hi' },
      }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('signature_missing');
  });

  test('rejects a malformed Signature header (401)', async () => {
    const res = await app.request('/a2a/v1/messages', {
      method: 'POST',
      headers: { ...headers(), signature: 'not-a-valid-signature-header' },
      body: JSON.stringify({
        from: 'did:web:peer',
        to: 'did:web:x',
        message: { type: 'question', content: 'hi' },
      }),
    });
    expect(res.status).toBe(401);
  });

  test('rejects a keyId that is not a did:web identifier (401)', async () => {
    const res = await app.request('/a2a/v1/messages', {
      method: 'POST',
      headers: {
        ...headers(),
        signature: 'keyId="key-1",algorithm="ed25519",headers="(request-target)",signature="AAA"',
      },
      body: JSON.stringify({
        from: 'did:web:peer',
        to: 'did:web:x',
        message: { type: 'question', content: 'hi' },
      }),
    });
    expect(res.status).toBe(401);
  });
});

describe('A2A signed message (real Ed25519, mocked DID resolution)', () => {
  const KEY_ID = 'did:web:localhost#key-1';
  let restoreFetch: () => void;

  afterEach(() => {
    restoreFetch();
    // Each test serves a fresh signing key from the same DID; clear the
    // resolver cache so a stale key from a prior test doesn't fail verification.
    clearDIDCache();
  });

  // Generate a key pair and serve its public half from the mocked DID document.
  async function signingKeyResolvedViaDid() {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const publicKeyMultibase = await publicKeyToMultibase(publicKey);
    const didDocument = {
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: 'did:web:localhost',
      verificationMethod: [
        {
          id: KEY_ID,
          type: 'Ed25519VerificationKey2020',
          controller: 'did:web:localhost',
          publicKeyMultibase,
        },
      ],
    };
    restoreFetch = mockFetch((url) => {
      if (url.includes('/.well-known/did.json')) return Response.json(didDocument);
      // The post-response agent loop calls the LLM; short-circuit it so the
      // suite makes no real external calls (its failure is caught and ignored).
      if (url.includes('api.anthropic.com')) return new Response('{}', { status: 401 });
      return undefined;
    });
    return privateKey;
  }

  function messageRequest(targetDid: string, content: string): Request {
    return new Request(MESSAGES, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: 'did:web:localhost',
        to: targetDid,
        message: { type: 'question', content },
      }),
    });
  }

  test('accepts a correctly signed message from a connected peer and persists it', async () => {
    const targetDid = 'did:web:localhost:agents:target';
    await seedTargetAgent(targetDid);
    await connectPeer('did:web:localhost');
    const privateKey = await signingKeyResolvedViaDid();

    const signed = await signRequest(
      messageRequest(targetDid, 'Hello target agent'),
      privateKey,
      KEY_ID,
    );

    const res = await app.request(signed);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.message_id).toBeTruthy();

    const [stored] = await getDb().select().from(messages).where(eq(messages.id, json.message_id));
    expect(stored?.sender_did).toBe('did:web:localhost');
    expect(stored?.content).toBe('Hello target agent');
    expect(stored?.via).toBe('a2a');
  });

  test('holds an unconnected peer as a pending connection request (202), not an LLM turn', async () => {
    const targetDid = 'did:web:localhost:agents:gated';
    await seedTargetAgent(targetDid);
    const privateKey = await signingKeyResolvedViaDid();

    const signed = await signRequest(messageRequest(targetDid, 'let me in'), privateKey, KEY_ID);
    const res = await app.request(signed);

    expect(res.status).toBe(202);
    expect((await res.json()).status).toBe('pending_connection');

    // A connection request is recorded; no conversation message is stored.
    const perms = await getDb().select().from(permissions).where(eq(permissions.user_id, user.id));
    expect(perms).toHaveLength(1);
    expect(perms[0]?.action).toBe('connect');
    expect(perms[0]?.decision).toBe('pending');
    expect(await getDb().select().from(messages)).toHaveLength(0);

    // Repeated messages from the same unconnected peer don't pile up requests.
    const signed2 = await signRequest(messageRequest(targetDid, 'again'), privateKey, KEY_ID);
    expect((await app.request(signed2)).status).toBe(202);
    expect(
      await getDb().select().from(permissions).where(eq(permissions.user_id, user.id)),
    ).toHaveLength(1);
  });

  test('rejects a message whose `from` is not authorized by the signing key (401)', async () => {
    const targetDid = 'did:web:localhost:agents:spoof';
    await seedTargetAgent(targetDid);
    const privateKey = await signingKeyResolvedViaDid();

    // Signed by did:web:localhost but claiming to be from another domain.
    const req = new Request(MESSAGES, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: 'did:web:attacker.example.com',
        to: targetDid,
        message: { type: 'question', content: 'spoofed' },
      }),
    });
    const signed = await signRequest(req, privateKey, KEY_ID);
    expect((await app.request(signed)).status).toBe(401);
  });

  test('rejects a tampered body whose signature no longer matches (401)', async () => {
    const targetDid = 'did:web:localhost:agents:target2';
    await seedTargetAgent(targetDid);
    const privateKey = await signingKeyResolvedViaDid();

    const signed = await signRequest(messageRequest(targetDid, 'original'), privateKey, KEY_ID);

    // Replay the signed headers over a different body.
    const tampered = new Request(MESSAGES, {
      method: 'POST',
      headers: signed.headers,
      body: JSON.stringify({
        from: 'did:web:localhost',
        to: targetDid,
        message: { type: 'question', content: 'tampered' },
      }),
    });
    const res = await app.request(tampered);
    expect(res.status).toBe(401);
  });
});
