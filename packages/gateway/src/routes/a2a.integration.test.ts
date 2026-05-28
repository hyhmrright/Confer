import { generateEd25519KeyPair, publicKeyToMultibase, signRequest } from '@confer/identity';
import { newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../app.js';
import { getDb } from '../db/connection.js';
import { agents, messages } from '../db/schema.js';
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

describe('A2A signature rejection', () => {
  test('rejects a request with no Signature header (401)', async () => {
    const res = await app.request('/a2a/v1/messages', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ from: 'did:web:peer', to: 'did:web:x', message: { type: 'question', content: 'hi' } }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('signature_missing');
  });

  test('rejects a malformed Signature header (401)', async () => {
    const res = await app.request('/a2a/v1/messages', {
      method: 'POST',
      headers: { ...headers(), signature: 'not-a-valid-signature-header' },
      body: JSON.stringify({ from: 'did:web:peer', to: 'did:web:x', message: { type: 'question', content: 'hi' } }),
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
      body: JSON.stringify({ from: 'did:web:peer', to: 'did:web:x', message: { type: 'question', content: 'hi' } }),
    });
    expect(res.status).toBe(401);
  });
});

describe('A2A signed message (real Ed25519, mocked DID resolution)', () => {
  const KEY_ID = 'did:web:localhost#key-1';
  let restoreFetch: () => void;

  afterEach(() => restoreFetch());

  // Generate a key pair and serve its public half from the mocked DID document.
  async function signingKeyResolvedViaDid() {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const publicKeyMultibase = await publicKeyToMultibase(publicKey);
    const didDocument = {
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: 'did:web:localhost',
      verificationMethod: [
        { id: KEY_ID, type: 'Ed25519VerificationKey2020', controller: 'did:web:localhost', publicKeyMultibase },
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
      body: JSON.stringify({ from: 'did:web:localhost', to: targetDid, message: { type: 'question', content } }),
    });
  }

  test('accepts a correctly signed message and persists it', async () => {
    const targetDid = 'did:web:localhost:agents:target';
    await seedTargetAgent(targetDid);
    const privateKey = await signingKeyResolvedViaDid();

    const signed = await signRequest(messageRequest(targetDid, 'Hello target agent'), privateKey, KEY_ID);

    const res = await app.request(signed);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.message_id).toBeTruthy();

    const [stored] = await getDb().select().from(messages).where(eq(messages.id, json.message_id));
    expect(stored?.sender_did).toBe('did:web:localhost');
    expect(stored?.content).toBe('Hello target agent');
    expect(stored?.via).toBe('a2a');
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
      body: JSON.stringify({ from: 'did:web:localhost', to: targetDid, message: { type: 'question', content: 'tampered' } }),
    });
    const res = await app.request(tampered);
    expect(res.status).toBe(401);
  });
});
