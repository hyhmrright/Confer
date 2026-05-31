import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  clearDIDCache,
  exportPrivateKey,
  generateEd25519KeyPair,
  publicKeyToMultibase,
  signRequest,
} from '@confer/identity';
import { encrypt, newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { app } from '../app.js';
import { getDb } from '../db/connection.js';
import { agents, keypairs, messages, peerAgents, peerContacts } from '../db/schema.js';
import { getEnv } from '../env.js';
import { type SeededUser, get, post, resetDb, seedUser } from '../test/helpers.js';

const CONSULT = '/api/v1/consult';
const PEER_DID = 'did:web:localhost';
const PEER_KEY_ID = 'did:web:localhost#key-1';

let user: SeededUser;
let myAgentDid: string;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

// Seed the user's own agent with an active, AES-encrypted signing key so
// deliverConsult can sign the outbound consult.
async function seedOwnAgent(): Promise<void> {
  const db = getDb();
  const agentId = newId();
  myAgentDid = `did:web:localhost:agents:me-${agentId.slice(-6).toLowerCase()}`;
  await db
    .insert(agents)
    .values({ id: agentId, user_id: user.id, did: myAgentDid, policies_json: {} });

  const kp = await generateEd25519KeyPair();
  const privJwk = await exportPrivateKey(kp.privateKey);
  const enc = await encrypt(JSON.stringify(privJwk), getEnv().ENCRYPTION_KEY);
  if (!enc.ok) throw new Error('failed to encrypt test key');

  await db.insert(keypairs).values({
    id: newId(),
    owner_type: 'agent',
    owner_id: agentId,
    key_id: `${myAgentDid}#key-1`,
    public_key_multibase: await publicKeyToMultibase(kp.publicKey),
    private_key_jwk_encrypted: enc.value,
    is_active: true,
  });
}

// Seed a connected peer contact. Returns the peer row id.
async function seedPeerContact(): Promise<string> {
  const db = getDb();
  const peerId = newId();
  await db.insert(peerAgents).values({
    id: peerId,
    did: PEER_DID,
    endpoint: 'https://peer.example/a2a/v1',
    public_key_json: {},
    agent_facts_json: {},
  });
  await db
    .insert(peerContacts)
    .values({ id: newId(), user_id: user.id, peer_id: peerId, added_via: 'manual' });
  return peerId;
}

// A fetch mock that acks outbound consult delivery and (when a peer signing key
// is registered) serves that key's DID document for inbound verification.
let restoreFetch: (() => void) | undefined;
function mockOutbound(opts: { didDocument?: unknown } = {}): void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (opts.didDocument && url.includes('/.well-known/did.json')) {
      return Promise.resolve(Response.json(opts.didDocument));
    }
    if (url.includes('api.anthropic.com'))
      return Promise.resolve(new Response('{}', { status: 401 }));
    if (url.includes('peer.example')) {
      return Promise.resolve(
        Response.json({ message_id: 'remote-1', thread_id: 't', stream_url: '/s' }),
      );
    }
    return realFetch(input, init);
  }) as typeof fetch;
  restoreFetch = () => {
    globalThis.fetch = realFetch;
  };
}

afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
  clearDIDCache();
});

describe('consult', () => {
  test('requires authentication', async () => {
    expect((await get(`${CONSULT}/x`)).status).toBe(401);
  });

  test('rejects consulting a non-contact peer (403)', async () => {
    await seedOwnAgent();
    const res = await post(`${CONSULT}/${newId()}`, {
      token: user.token,
      body: { question: 'hi' },
    });
    expect(res.status).toBe(403);
  });

  test('initiates a consult, signs+delivers, stores message as sent', async () => {
    await seedOwnAgent();
    const peerId = await seedPeerContact();
    mockOutbound();

    const res = await post(`${CONSULT}/${peerId}`, {
      token: user.token,
      body: { question: 'How do I rotate keys?' },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('sent');

    const [stored] = await getDb()
      .select()
      .from(messages)
      .where(eq(messages.id, body.message_id))
      .limit(1);
    expect(stored?.delivery_status).toBe('sent');
    expect(stored?.sender_type).toBe('user');
  });

  test('records delivery failure as failed (502)', async () => {
    await seedOwnAgent();
    const peerId = await seedPeerContact();
    // No mock: outbound fetch to peer.example fails -> deliverConsult returns err.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(new Response('boom', { status: 500 }))) as unknown as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = realFetch;
    };

    const res = await post(`${CONSULT}/${peerId}`, { token: user.token, body: { question: 'x' } });
    expect(res.status).toBe(502);
    expect((await res.json()).status).toBe('failed');
  });

  test('reply long-poll returns pending when no answer yet', async () => {
    await seedOwnAgent();
    const peerId = await seedPeerContact();
    mockOutbound();
    const sent = await post(`${CONSULT}/${peerId}`, { token: user.token, body: { question: 'q' } });
    const { conversation_id, message_id } = await sent.json();

    const res = await get(`${CONSULT}/${conversation_id}/reply?after=${message_id}&wait=1`, {
      token: user.token,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('pending');
  });

  test('peer answer via inbound /a2a/v1/messages is correlated and retrievable', async () => {
    await seedOwnAgent();
    const peerId = await seedPeerContact();

    // The peer's signing key, served via its mocked DID document.
    const peerKp = await generateEd25519KeyPair();
    const didDocument = {
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: PEER_DID,
      verificationMethod: [
        {
          id: PEER_KEY_ID,
          type: 'Ed25519VerificationKey2020',
          controller: PEER_DID,
          publicKeyMultibase: await publicKeyToMultibase(peerKp.publicKey),
        },
      ],
    };
    mockOutbound({ didDocument });

    const sent = await post(`${CONSULT}/${peerId}`, { token: user.token, body: { question: 'q' } });
    const { conversation_id, message_id } = await sent.json();

    // Peer's signed async answer carrying thread_id = conversation_id.
    const signed = await signRequest(
      new Request('http://localhost/a2a/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from: PEER_DID,
          to: myAgentDid,
          thread_id: conversation_id,
          message: { type: 'answer', content: 'Use AES-256-GCM and rotate quarterly.' },
        }),
      }),
      peerKp.privateKey,
      PEER_KEY_ID,
    );
    const inboundRes = await app.request(signed);
    expect(inboundRes.status).toBe(201);

    const res = await get(`${CONSULT}/${conversation_id}/reply?after=${message_id}&wait=3`, {
      token: user.token,
    });
    const body = await res.json();
    expect(body.status).toBe('answered');
    expect(body.message.content).toContain('AES-256-GCM');
  });

  test('non-numeric wait does not hang (returns pending promptly)', async () => {
    await seedOwnAgent();
    const peerId = await seedPeerContact();
    mockOutbound();
    const sent = await post(`${CONSULT}/${peerId}`, { token: user.token, body: { question: 'q' } });
    const { conversation_id, message_id } = await sent.json();

    const started = Date.now();
    const res = await get(`${CONSULT}/${conversation_id}/reply?after=${message_id}&wait=abc`, {
      token: user.token,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('pending');
    // A garbage value must not loop forever (the NaN-deadline bug); it returns
    // immediately rather than polling.
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test('unknown after cursor is rejected (400) rather than returning a stale reply', async () => {
    await seedOwnAgent();
    const peerId = await seedPeerContact();
    mockOutbound();
    const sent = await post(`${CONSULT}/${peerId}`, { token: user.token, body: { question: 'q' } });
    const { conversation_id } = await sent.json();

    const res = await get(
      `${CONSULT}/${conversation_id}/reply?after=01HZZZZZZZZZZZZZZZZZZZZZZZ&wait=1`,
      { token: user.token },
    );
    expect(res.status).toBe(400);
  });

  test('a connected peer cannot inject an answer into another peer thread', async () => {
    await seedOwnAgent();
    const peerAId = await seedPeerContact(); // consult target (did:web:localhost)

    // Peer B: a different connected peer with its own signing key.
    const bDid = 'did:web:localhost:agents:peerb';
    const bKeyId = `${bDid}#key-1`;
    const db = getDb();
    const bPeerId = newId();
    await db.insert(peerAgents).values({
      id: bPeerId,
      did: bDid,
      endpoint: 'https://peerb.example/a2a/v1',
      public_key_json: {},
      agent_facts_json: {},
    });
    await db
      .insert(peerContacts)
      .values({ id: newId(), user_id: user.id, peer_id: bPeerId, added_via: 'manual' });

    const bKp = await generateEd25519KeyPair();
    // domainFromDid collapses both DIDs to `localhost`, so B's doc is served at
    // the same /.well-known/did.json the resolver fetches for the signer.
    const bDoc = {
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: bDid,
      verificationMethod: [
        {
          id: bKeyId,
          type: 'Ed25519VerificationKey2020',
          controller: bDid,
          publicKeyMultibase: await publicKeyToMultibase(bKp.publicKey),
        },
      ],
    };
    mockOutbound({ didDocument: bDoc });

    // Start a consult with peer A -> conv1 (B is NOT a participant).
    const sent = await post(`${CONSULT}/${peerAId}`, {
      token: user.token,
      body: { question: 'q' },
    });
    const { conversation_id, message_id } = await sent.json();

    // B signs an answer targeting conv1.
    const signed = await signRequest(
      new Request('http://localhost/a2a/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from: bDid,
          to: myAgentDid,
          thread_id: conversation_id,
          message: { type: 'answer', content: 'INJECTED by peer B' },
        }),
      }),
      bKp.privateKey,
      bKeyId,
    );
    const inbound = await app.request(signed);
    expect(inbound.status).toBe(201); // accepted, but routed to a fresh thread

    // conv1 must NOT surface B's message as the answer.
    const res = await get(`${CONSULT}/${conversation_id}/reply?after=${message_id}&wait=1`, {
      token: user.token,
    });
    expect((await res.json()).status).toBe('pending');
  });
});
