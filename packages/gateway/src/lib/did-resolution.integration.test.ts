import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { clearDIDCache, importPrivateKey, signRequest } from '@confer/identity';
import { eq } from 'drizzle-orm';
import { loadOwnerSigningKey } from '../a2a/signing.js';
import { app } from '../app.js';
import { getDb } from '../db/connection.js';
import { agents, peerAgents, users } from '../db/schema.js';
import { mockFetch, post, resetDb } from '../test/helpers.js';
import { resolveDidDocument } from './did-resolution.js';
import { upsertPeerAgent } from './peer-agent.js';
import { instanceDid, selfA2AEndpoint } from './public-identity.js';

/*
  These exercise the two halves of same-instance A2A, both of which were broken
  in every deployment: the gateway could not resolve the identities it had
  minted itself (it fetched them back over https from an address serving plain
  http), and it signed with a keypair row nothing ever created.

  Registration is driven through the real route on purpose. The previous tests
  hand-seeded users, agents and keypairs, and the shapes they invented were not
  the shapes registration writes — which is exactly how both defects survived a
  green suite.
*/

interface Registered {
  username: string;
  did: string;
  userId: string;
  agentDid: string;
}

async function register(username: string): Promise<Registered> {
  const res = await post('/api/v1/auth/register', {
    body: { username, password: 'correct-horse-battery', device_id: `dev-${username}` },
  });
  expect(res.status).toBe(201);

  const [user] = await getDb()
    .select({ id: users.id, did: users.did })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (!user) throw new Error(`register did not create ${username}`);

  const [agent] = await getDb()
    .select({ did: agents.did })
    .from(agents)
    .where(eq(agents.user_id, user.id))
    .limit(1);
  if (!agent) throw new Error(`register did not create an agent for ${username}`);

  return { username, did: user.did, userId: user.id, agentDid: agent.did };
}

let restoreFetch: (() => void) | undefined;

/** Fail the test if anything reaches the network, and record what tried. */
function forbidNetwork(): { calls: string[] } {
  const calls: string[] = [];
  restoreFetch = mockFetch((url) => {
    calls.push(url);
    return new Response('the network should not have been consulted', { status: 599 });
  });
  return { calls };
}

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
  clearDIDCache();
});

describe('resolving our own identities', () => {
  test("answers a registered user's DID from the database, without a fetch", async () => {
    const alice = await register('alice');
    const seen = forbidNetwork();

    const result = await resolveDidDocument(alice.did);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe(alice.did);
    expect(seen.calls).toEqual([]);
  });

  // The document has to carry the very key the outbound path signs with, or a
  // peer resolves us and still cannot verify anything we send.
  test('publishes the same key the signing path uses', async () => {
    const alice = await register('alice');
    const signing = await loadOwnerSigningKey(alice.userId);
    expect(signing.ok).toBe(true);
    if (!signing.ok) return;

    forbidNetwork();
    const result = await resolveDidDocument(alice.did);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.verificationMethod.map((m) => m.id)).toContain(signing.value.keyId);
    expect(result.value.authentication).toContain(signing.value.keyId);
  });

  test("answers this instance's own DID", async () => {
    forbidNetwork();
    const result = await resolveDidDocument(instanceDid());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe(instanceDid());
  });

  // Our own routes serve the instance document and one per user, and nothing
  // else. A sub-identifier neither would serve is reported as unknown rather
  // than fetched — going to the network would only retrieve our own 404.
  test('reports an unminted identity under our authority as not found', async () => {
    const seen = forbidNetwork();
    const result = await resolveDidDocument(`${instanceDid()}:agents:nobody`);
    expect(result.ok).toBe(false);
    expect(seen.calls).toEqual([]);
  });

  test('still resolves a foreign DID over the network', async () => {
    const foreign = 'did:web:peer.example:agents:bob';
    const seen: string[] = [];
    restoreFetch = mockFetch((url) => {
      seen.push(url);
      return Response.json({
        '@context': ['https://www.w3.org/ns/did/v1'],
        id: foreign,
        verificationMethod: [],
      });
    });

    const result = await resolveDidDocument(foreign);
    expect(result.ok).toBe(true);
    expect(seen).toEqual(['https://peer.example/agents/bob/did.json']);
  });
});

describe('same-instance A2A', () => {
  // The end-to-end shape of both fixes. Before them this request was rejected
  // at `did_resolution_failed` — the signature was never even examined — and
  // the reply could not have been signed either.
  test('accepts a message signed by another account on this instance', async () => {
    const alice = await register('alice');
    const bob = await register('bob');

    const key = await loadOwnerSigningKey(alice.userId);
    expect(key.ok).toBe(true);
    if (!key.ok) return;

    const signed = await signRequest(
      new Request('http://localhost/a2a/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from: alice.agentDid,
          to: bob.agentDid,
          message: { type: 'question', content: 'Are you free on Thursday?' },
        }),
      }),
      await importPrivateKey(JSON.parse(key.value.privateKeyJwk) as JsonWebKey),
      key.value.keyId,
    );

    const seen = forbidNetwork();
    const res = await app.request(signed);

    // Alice is a stranger to Bob, so admission holds the message for Bob to
    // approve — that is the contact-consent gate doing its job, and it is
    // reached only once the signature has been verified.
    expect(res.status).not.toBe(401);
    expect(seen.calls).toEqual([]);

    // And Bob's side has somewhere to answer. A Confer peer signs as its owner
    // but sends `from` as its AGENT DID, which no route serves a document for,
    // so resolving it would have recorded the peer with an empty endpoint and
    // every reply would be dropped.
    const [peer] = await getDb()
      .select({ endpoint: peerAgents.endpoint })
      .from(peerAgents)
      .where(eq(peerAgents.did, alice.agentDid))
      .limit(1);
    expect(peer?.endpoint).toBe(selfA2AEndpoint());
  });

  // Inbound A2A knows only a DID, and passes '' when it cannot work out where
  // the peer lives. Writing that would erase the endpoint contact discovery
  // stored, leaving the peer reachable exactly until it first spoke to us.
  test('an unresolvable endpoint never overwrites a known one', async () => {
    const did = 'did:web:peer.example:agents:bob';
    await upsertPeerAgent({ did, endpoint: 'https://peer.example/a2a/v1' });
    await upsertPeerAgent({ did, endpoint: '' });

    const [peer] = await getDb()
      .select({ endpoint: peerAgents.endpoint })
      .from(peerAgents)
      .where(eq(peerAgents.did, did))
      .limit(1);
    expect(peer?.endpoint).toBe('https://peer.example/a2a/v1');
  });

  test('still rejects a forged signature from a local identity', async () => {
    const alice = await register('alice');
    const bob = await register('bob');
    const mallory = await register('mallory');

    // Signed with mallory's key but claiming to be alice.
    const key = await loadOwnerSigningKey(mallory.userId);
    expect(key.ok).toBe(true);
    if (!key.ok) return;

    const signed = await signRequest(
      new Request('http://localhost/a2a/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from: alice.agentDid,
          to: bob.agentDid,
          message: { type: 'question', content: 'Wire me the deposit.' },
        }),
      }),
      await importPrivateKey(JSON.parse(key.value.privateKeyJwk) as JsonWebKey),
      key.value.keyId,
    );

    forbidNetwork();
    const res = await app.request(signed);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('sender_mismatch');
  });
});
