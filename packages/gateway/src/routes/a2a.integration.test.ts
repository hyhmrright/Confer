import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  clearDIDCache,
  generateEd25519KeyPair,
  publicKeyToMultibase,
  signRequest,
} from '@confer/identity';
import { encrypt, newId } from '@confer/shared';
import { and, eq } from 'drizzle-orm';
import { app } from '../app.js';
import { getDb } from '../db/connection.js';
import {
  agents,
  conversations,
  messages,
  peerAgents,
  peerContacts,
  permissions,
  users,
} from '../db/schema.js';
import { getEnv } from '../env.js';
import {
  type SeededUser,
  get,
  headers,
  mockFetch,
  post,
  resetDb,
  seedUser,
} from '../test/helpers.js';

const MESSAGES = 'http://localhost/a2a/v1/messages';
let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

// Seed the user's own agent. `policies` defaults to {} (empty config → `allow`
// for ordinary L2 questions). Pass `{ default: 'ask_user' }` (or an explicit
// rule) to exercise the offline-answer hold gate. Returns the agent id.
async function seedTargetAgent(
  did: string,
  policies: Record<string, unknown> = {},
): Promise<string> {
  const agentId = newId();
  await getDb()
    .insert(agents)
    .values({ id: agentId, user_id: user.id, did, policies_json: policies });
  return agentId;
}

// Give the user an AES-encrypted Anthropic key so processA2AMessage can build a
// provider and reach the (mocked) LLM when a held question is approved.
async function seedUserLlmKey(): Promise<void> {
  const enc = await encrypt('sk-test-anthropic', getEnv().ENCRYPTION_KEY);
  if (!enc.ok) throw new Error('failed to encrypt test LLM key');
  await getDb()
    .update(users)
    .set({ llm_keys_json: { anthropic: enc.value } })
    .where(eq(users.id, user.id));
}

// Make `did` a connected contact of the seeded user so the consent gate lets
// its messages through to the agent loop. Returns the peer row id.
async function connectPeer(did: string): Promise<string> {
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
  return peerId;
}

// Poll until `fn` returns a truthy value or the timeout elapses. Approving a held
// question runs the agent loop fire-and-forget, so reads must poll, not sleep.
async function waitFor<T>(
  fn: () => Promise<T | null | undefined>,
  timeoutMs = 4000,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 50));
  }
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
  async function signingKeyResolvedViaDid(opts: { llmReply?: string } = {}) {
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
      // The post-response agent loop calls the LLM. By default short-circuit it
      // (401) so the suite makes no real external calls. A test that approves a
      // held question passes `llmReply` to get a valid Anthropic response so the
      // agent actually produces an answer.
      if (url.includes('api.anthropic.com')) {
        return opts.llmReply
          ? Response.json({
              id: 'msg_test',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: opts.llmReply }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 1, output_tokens: 1 },
            })
          : new Response('{}', { status: 401 });
      }
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

  // ---- ask_user offline-answer gate ----
  // An agent whose policy holds ordinary questions for the owner ("ask me").
  const ASK_USER = { default: 'ask_user' };

  test('holds a connected peer question for owner review when policy is ask_user (202)', async () => {
    const targetDid = 'did:web:localhost:agents:held';
    await seedTargetAgent(targetDid, ASK_USER);
    await connectPeer('did:web:localhost');
    const privateKey = await signingKeyResolvedViaDid();

    const signed = await signRequest(
      messageRequest(targetDid, 'What is your SLA?'),
      privateKey,
      KEY_ID,
    );
    const res = await app.request(signed);

    expect(res.status).toBe(202);
    expect((await res.json()).status).toBe('pending_approval');

    // The inbound question is stored (the owner can see it) but the agent did
    // not auto-reply — no own_agent message exists.
    const msgs = await getDb().select().from(messages);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.sender_type).toBe('peer_agent');

    // A pending `ask` permission with the a2a_question scope was recorded.
    const perms = await getDb()
      .select()
      .from(permissions)
      .where(and(eq(permissions.user_id, user.id), eq(permissions.action, 'ask')));
    expect(perms).toHaveLength(1);
    expect(perms[0]?.decision).toBe('pending');
    expect((perms[0]?.scope_json as { kind?: string })?.kind).toBe('a2a_question');
  });

  test('a held question appears in the owner pending inbox with the question text', async () => {
    const targetDid = 'did:web:localhost:agents:held2';
    await seedTargetAgent(targetDid, ASK_USER);
    await connectPeer('did:web:localhost');
    const privateKey = await signingKeyResolvedViaDid();
    await app.request(
      await signRequest(messageRequest(targetDid, 'Ship dates?'), privateKey, KEY_ID),
    );

    const res = await get('/api/v1/permissions/pending', { token: user.token });
    expect(res.status).toBe(200);
    const pending = (await res.json()).permissions as Array<{
      action: string;
      description: string;
    }>;
    const ask = pending.find((p) => p.action === 'ask');
    expect(ask).toBeTruthy();
    expect(ask?.description).toContain('Ship dates?');
  });

  test('approving a held question lets the agent answer it (own_agent reply appears)', async () => {
    const targetDid = 'did:web:localhost:agents:held3';
    await seedTargetAgent(targetDid, ASK_USER);
    await connectPeer('did:web:localhost');
    await seedUserLlmKey();
    const privateKey = await signingKeyResolvedViaDid({ llmReply: 'Our SLA is 99.9% uptime.' });

    const inbound = await app.request(
      await signRequest(messageRequest(targetDid, 'SLA?'), privateKey, KEY_ID),
    );
    const inboundMsgId = (await inbound.json()).message_id;

    const [perm] = await getDb()
      .select()
      .from(permissions)
      .where(and(eq(permissions.user_id, user.id), eq(permissions.action, 'ask')));
    const decided = await post(`/api/v1/permissions/${perm?.id}/decide`, {
      token: user.token,
      body: { decision: 'allow_once', scope: 'peer_action' },
    });
    expect(decided.status).toBe(200);

    const reply = await waitFor(async () => {
      const [r] = await getDb()
        .select()
        .from(messages)
        .where(eq(messages.in_reply_to, inboundMsgId));
      return r;
    });
    expect(reply?.sender_type).toBe('own_agent');
    expect(reply?.content).toContain('99.9%');
  });

  test('denying a held question produces no reply', async () => {
    const targetDid = 'did:web:localhost:agents:held4';
    await seedTargetAgent(targetDid, ASK_USER);
    await connectPeer('did:web:localhost');
    const privateKey = await signingKeyResolvedViaDid();

    const inbound = await app.request(
      await signRequest(messageRequest(targetDid, 'SLA?'), privateKey, KEY_ID),
    );
    const inboundMsgId = (await inbound.json()).message_id;

    const [perm] = await getDb()
      .select()
      .from(permissions)
      .where(and(eq(permissions.user_id, user.id), eq(permissions.action, 'ask')));
    const decided = await post(`/api/v1/permissions/${perm?.id}/decide`, {
      token: user.token,
      body: { decision: 'deny', scope: 'peer_action' },
    });
    expect(decided.status).toBe(200);

    // Give a (correctly suppressed) resume a window to not run, then assert no reply.
    await new Promise((r) => setTimeout(r, 300));
    const replies = await getDb()
      .select()
      .from(messages)
      .where(eq(messages.in_reply_to, inboundMsgId));
    expect(replies).toHaveLength(0);
  });

  test('a connected peer under the default (allow) policy is answered immediately (201)', async () => {
    const targetDid = 'did:web:localhost:agents:allow';
    await seedTargetAgent(targetDid); // empty policy => default allow (connection is consent)
    await connectPeer('did:web:localhost');
    await seedUserLlmKey();
    const privateKey = await signingKeyResolvedViaDid({ llmReply: 'Sure — happy to help.' });

    const inbound = await app.request(
      await signRequest(messageRequest(targetDid, 'hi'), privateKey, KEY_ID),
    );
    expect(inbound.status).toBe(201);
    const inboundMsgId = (await inbound.json()).message_id;

    // Nothing was held for approval under the default policy.
    const perms = await getDb()
      .select()
      .from(permissions)
      .where(and(eq(permissions.user_id, user.id), eq(permissions.action, 'ask')));
    expect(perms).toHaveLength(0);

    const reply = await waitFor(async () => {
      const [r] = await getDb()
        .select()
        .from(messages)
        .where(eq(messages.in_reply_to, inboundMsgId));
      return r;
    });
    expect(reply?.sender_type).toBe('own_agent');
  });

  test('a held question is not answered if the contact was removed before approval', async () => {
    const targetDid = 'did:web:localhost:agents:held5';
    await seedTargetAgent(targetDid, ASK_USER);
    const peerId = await connectPeer('did:web:localhost');
    await seedUserLlmKey();
    const privateKey = await signingKeyResolvedViaDid({ llmReply: 'should not be sent' });

    const inbound = await app.request(
      await signRequest(messageRequest(targetDid, 'SLA?'), privateKey, KEY_ID),
    );
    const inboundMsgId = (await inbound.json()).message_id;

    const [perm] = await getDb()
      .select()
      .from(permissions)
      .where(and(eq(permissions.user_id, user.id), eq(permissions.action, 'ask')));

    // Owner disconnects the peer, then approves the now-stale held question.
    await getDb()
      .delete(peerContacts)
      .where(and(eq(peerContacts.user_id, user.id), eq(peerContacts.peer_id, peerId)));
    const decided = await post(`/api/v1/permissions/${perm?.id}/decide`, {
      token: user.token,
      body: { decision: 'allow_once', scope: 'peer_action' },
    });
    expect(decided.status).toBe(200);

    await new Promise((r) => setTimeout(r, 300));
    const replies = await getDb()
      .select()
      .from(messages)
      .where(eq(messages.in_reply_to, inboundMsgId));
    expect(replies).toHaveLength(0);
  });
});

describe('A2A reply stream authorization (IDOR)', () => {
  const SENDER_DID = 'did:web:localhost';
  const SENDER_KEY = 'did:web:localhost#key-1';
  const OTHER_DID = 'did:web:peer-b.example';
  const OTHER_KEY = 'did:web:peer-b.example#key-1';
  let restoreFetch: () => void;

  afterEach(() => {
    restoreFetch();
    clearDIDCache();
  });

  function didDoc(id: string, keyId: string, publicKeyMultibase: string) {
    return {
      '@context': ['https://www.w3.org/ns/did/v1'],
      id,
      verificationMethod: [
        { id: keyId, type: 'Ed25519VerificationKey2020', controller: id, publicKeyMultibase },
      ],
    };
  }

  // Serve a DID document per peer from the mocked resolver, each carrying its
  // own Ed25519 public key. Returns the matching private keys for signing.
  async function servePeers() {
    const sender = await generateEd25519KeyPair();
    const other = await generateEd25519KeyPair();
    const docs: Record<string, unknown> = {
      'localhost/.well-known/did.json': didDoc(
        SENDER_DID,
        SENDER_KEY,
        await publicKeyToMultibase(sender.publicKey),
      ),
      'peer-b.example/.well-known/did.json': didDoc(
        OTHER_DID,
        OTHER_KEY,
        await publicKeyToMultibase(other.publicKey),
      ),
    };
    restoreFetch = mockFetch((url) => {
      for (const [needle, doc] of Object.entries(docs)) {
        if (url.includes(needle)) return Response.json(doc);
      }
      return undefined;
    });
    return { senderKey: sender.privateKey, otherKey: other.privateKey };
  }

  // Seed an inbound message from SENDER_DID plus the agent's reply to it.
  async function seedMessageWithReply(): Promise<string> {
    const db = getDb();
    const convId = newId();
    await db
      .insert(conversations)
      .values({ id: convId, type: 'direct_agent_agent', created_by: user.id });
    const inboundId = newId();
    await db.insert(messages).values({
      id: inboundId,
      conversation_id: convId,
      sender_type: 'agent',
      sender_id: newId(),
      sender_did: SENDER_DID,
      content: 'question',
      via: 'a2a',
    });
    await db.insert(messages).values({
      id: newId(),
      conversation_id: convId,
      sender_type: 'agent',
      sender_id: newId(),
      in_reply_to: inboundId,
      content: 'the secret answer',
    });
    return inboundId;
  }

  function streamRequest(messageId: string): Request {
    return new Request(`http://localhost/a2a/v1/stream/${messageId}`, { method: 'GET' });
  }

  test('lets the original sender read its own reply (200)', async () => {
    const { senderKey } = await servePeers();
    const messageId = await seedMessageWithReply();

    const signed = await signRequest(streamRequest(messageId), senderKey, SENDER_KEY);
    const res = await app.request(signed);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('the secret answer');
  });

  test('rejects a different signed peer reading the reply (403)', async () => {
    const { otherKey } = await servePeers();
    const messageId = await seedMessageWithReply();

    const signed = await signRequest(streamRequest(messageId), otherKey, OTHER_KEY);
    const res = await app.request(signed);

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('forbidden');
  });
});
