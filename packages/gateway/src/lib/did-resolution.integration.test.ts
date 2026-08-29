import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { clearDIDCache, importPrivateKey, signRequest } from '@confer/identity';
import { newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { loadOwnerSigningKey } from '../a2a/signing.js';
import { app } from '../app.js';
import { getDb } from '../db/connection.js';
import { agents, peerAgents, peerContacts, users } from '../db/schema.js';
import { mockFetch, post, put, resetDb } from '../test/helpers.js';
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
  token: string;
}

async function register(username: string): Promise<Registered> {
  const res = await post('/api/v1/auth/register', {
    body: { username, password: 'correct-horse-battery', device_id: `dev-${username}` },
  });
  expect(res.status).toBe(201);
  const { access_token: token } = (await res.json()) as { access_token: string };

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

  return { username, did: user.did, userId: user.id, agentDid: agent.did, token };
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

  // Two DIDs name the same agent: the `<user>:agent` one that public discovery
  // lists, and the owner's, which is the only one with a resolvable document
  // and the one the app shows behind a copy button. Delivery matched the first
  // only, so a contact added from a pasted DID connected, verified, and then
  // failed with "Target agent not found".
  test("accepts a message addressed to the owner's DID, not just the agent's", async () => {
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
          to: bob.did, // the published, resolvable identifier
          message: { type: 'question', content: 'Reachable?' },
        }),
      }),
      await importPrivateKey(JSON.parse(key.value.privateKeyJwk) as JsonWebKey),
      key.value.keyId,
    );

    forbidNetwork();
    const res = await app.request(signed);
    expect(res.status).not.toBe(404);
    expect(res.status).not.toBe(401);
  });

  test('still 404s for a DID belonging to nobody here', async () => {
    const alice = await register('alice');
    const key = await loadOwnerSigningKey(alice.userId);
    expect(key.ok).toBe(true);
    if (!key.ok) return;

    const signed = await signRequest(
      new Request('http://localhost/a2a/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from: alice.agentDid,
          to: `${instanceDid()}:agents:nobody`,
          message: { type: 'question', content: 'Anyone?' },
        }),
      }),
      await importPrivateKey(JSON.parse(key.value.privateKeyJwk) as JsonWebKey),
      key.value.keyId,
    );

    forbidNetwork();
    expect((await app.request(signed)).status).toBe(404);
  });

  // A peer added by its resolvable (owner) DID then speaks as its AGENT DID.
  // Keyed on `from` alone that looked like a different, unconnected peer — so
  // the answer to your own question came back as a connection request from a
  // stranger and sat in the permission inbox.
  test('recognises a contact added by the DID that actually resolves', async () => {
    const alice = await register('alice');
    const bob = await register('bob');

    // Bob adds Alice the only way the UI allows: by the DID she can copy.
    const peer = await upsertPeerAgent({ did: alice.did, endpoint: selfA2AEndpoint() });
    if (!peer) throw new Error('expected a peer row');
    await getDb().insert(peerContacts).values({
      id: newId(),
      user_id: bob.userId,
      peer_id: peer.id,
    });

    const key = await loadOwnerSigningKey(alice.userId);
    expect(key.ok).toBe(true);
    if (!key.ok) return;

    const signed = await signRequest(
      new Request('http://localhost/a2a/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from: alice.agentDid, // …but speaks as her agent
          to: bob.agentDid,
          message: { type: 'answer', content: 'Thursday works.' },
        }),
      }),
      await importPrivateKey(JSON.parse(key.value.privateKeyJwk) as JsonWebKey),
      key.value.keyId,
    );

    forbidNetwork();
    const res = await app.request(signed);

    // 202 is "pending_connection" — the failure this covers. A connected peer
    // gets its message accepted.
    expect(res.status).not.toBe(202);
    expect(res.status).toBeLessThan(300);
  });

  // A thread id names a conversation on the machine that created it, and
  // `resolveOrCreateThread` refuses one the caller does not own — correctly,
  // that is a tenant boundary. So a reply must be addressed with the thread id
  // the ASKER sent. Replying with our own filed the answer under a brand new
  // conversation on their side while they went on polling the one they made:
  // every consult sat at "pending" forever with a good answer on both machines.
  test("a reply is addressed with the asker's thread id, not ours", async () => {
    const alice = await register('alice');
    const bob = await register('bob');

    // Alice is a contact of Bob's, so her question is answered rather than held.
    const alicePeer = await upsertPeerAgent({
      did: alice.agentDid,
      endpoint: selfA2AEndpoint(),
    });
    if (!alicePeer) throw new Error('expected a peer row');
    await getDb()
      .insert(peerContacts)
      .values({ id: newId(), user_id: bob.userId, peer_id: alicePeer.id });

    await put('/api/v1/agents/me/llm-keys', {
      token: bob.token,
      body: { provider: 'openai', api_key: 'sk-test-llm' },
    });
    await getDb()
      .update(agents)
      .set({ model_config_json: { provider: 'openai', model: 'gpt-4.1-mini' } })
      .where(eq(agents.user_id, bob.userId));

    const ALICE_THREAD = 'alice-thread-01M0000000000000000000000';
    const outbound: Array<Record<string, unknown>> = [];
    restoreFetch = mockFetch((url, _init, input) => {
      if (url.includes('/embeddings')) {
        const v = new Array(1536).fill(0);
        v[0] = 1;
        return Response.json({ data: [{ embedding: v, index: 0 }] });
      }
      if (url.includes('/chat/completions')) {
        return new Response(
          'data: {"choices":[{"delta":{"content":"Thursday."}}]}\n\ndata: [DONE]\n\n',
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      }
      // The reply Bob's gateway sends back to Alice's advertised endpoint.
      if (url.includes('/a2a/v1/messages')) {
        // The signed Request carries the body, so read it from there.
        void (input as Request)
          .clone()
          .json()
          .then((b) => outbound.push(b as Record<string, unknown>));
        return Response.json(
          { message_id: 'r1', thread_id: ALICE_THREAD, stream_url: '' },
          {
            status: 201,
          },
        );
      }
      return undefined;
    });

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
          thread_id: ALICE_THREAD,
          message: { type: 'question', content: 'Are you free on Thursday?' },
        }),
      }),
      await importPrivateKey(JSON.parse(key.value.privateKeyJwk) as JsonWebKey),
      key.value.keyId,
    );
    expect((await app.request(signed)).status).toBeLessThan(300);

    // The turn is spawned off the request, so wait for the reply to go out.
    for (let i = 0; i < 100 && outbound.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(outbound).toHaveLength(1);
    expect(outbound[0]?.thread_id).toBe(ALICE_THREAD);
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
