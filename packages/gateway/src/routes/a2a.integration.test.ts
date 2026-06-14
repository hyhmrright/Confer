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
  agentMemories,
  agents,
  conversations,
  knowledgeBases,
  messages,
  peerAgents,
  peerContacts,
  permissions,
  users,
} from '../db/schema.js';
import { getEnv } from '../env.js';
import { ensureMemoryCollection } from '../lib/memory-store.js';
import { ensureCollection, upsertChunks } from '../lib/qdrant.js';
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

// Encode Anthropic SSE events into a text/event-stream Response, matching the
// event shapes AnthropicProvider.stream() parses (content_block_start /
// content_block_delta text_delta+input_json_delta / message_stop).
function sseResponse(events: Array<Record<string, unknown>>): Response {
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

// A streamed plain-text Anthropic reply (no tool calls).
function anthropicTextStream(text: string): Response {
  return sseResponse([
    { type: 'message_start', message: { id: 'msg_test', role: 'assistant' } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    { type: 'message_stop' },
  ]);
}

// A streamed Anthropic reply that emits a single tool_use block (no text). The
// orchestrator runs the tool, then re-streams; the second stream returns text.
function anthropicToolUseStream(toolName: string, args: Record<string, unknown>): Response {
  const json = JSON.stringify(args);
  return sseResponse([
    { type: 'message_start', message: { id: 'msg_tool', role: 'assistant' } },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_1', name: toolName, input: {} },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: json },
    },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
    { type: 'message_stop' },
  ]);
}

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

// Like `connectPeer` but also writes a per-contact `policy_overrides_json`, so
// the inbound A2A gate exercises the per-contact override merge. Returns the
// peer row id.
async function connectPeerWithOverride(
  did: string,
  overrides: Record<string, unknown>,
): Promise<string> {
  const db = getDb();
  const peerId = newId();
  await db.insert(peerAgents).values({
    id: peerId,
    did,
    endpoint: 'https://localhost/a2a/v1',
    public_key_json: {},
    agent_facts_json: {},
  });
  await db.insert(peerContacts).values({
    id: newId(),
    user_id: user.id,
    peer_id: peerId,
    added_via: 'manual',
    policy_overrides_json: overrides,
  });
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
      // The post-response agent loop calls the LLM via provider.stream (the
      // shared orchestrator is streaming end-to-end), so the mock must return a
      // text/event-stream Anthropic response. By default short-circuit it (401)
      // so the suite makes no real external calls; a test that approves a held
      // question passes `llmReply` to get a valid streamed answer.
      if (url.includes('api.anthropic.com')) {
        return opts.llmReply
          ? anthropicTextStream(opts.llmReply)
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

  test('a per-contact ask_user override holds a peer the agent would otherwise allow (202)', async () => {
    const targetDid = 'did:web:localhost:agents:perpeer-hold';
    // Agent default is `allow` (empty policy) — only the per-contact override
    // turns this peer's questions into held approvals.
    await seedTargetAgent(targetDid);
    await connectPeerWithOverride('did:web:localhost', { default: 'ask_user' });
    const privateKey = await signingKeyResolvedViaDid();

    const res = await app.request(
      await signRequest(messageRequest(targetDid, 'What is your SLA?'), privateKey, KEY_ID),
    );

    expect(res.status).toBe(202);
    expect((await res.json()).status).toBe('pending_approval');

    // The inbound question is stored but no auto-reply was produced.
    const msgs = await getDb().select().from(messages);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.sender_type).toBe('peer_agent');

    // A pending `ask` permission was recorded for owner review.
    const perms = await getDb()
      .select()
      .from(permissions)
      .where(and(eq(permissions.user_id, user.id), eq(permissions.action, 'ask')));
    expect(perms).toHaveLength(1);
    expect(perms[0]?.decision).toBe('pending');
    expect((perms[0]?.scope_json as { kind?: string })?.kind).toBe('a2a_question');
  });

  test('a peer with an empty override is answered immediately, identical to no override (201)', async () => {
    const targetDid = 'did:web:localhost:agents:perpeer-empty';
    await seedTargetAgent(targetDid); // agent default allow
    // An explicit but empty override must be a no-op (identity merge).
    await connectPeerWithOverride('did:web:localhost', {});
    await seedUserLlmKey();
    const privateKey = await signingKeyResolvedViaDid({ llmReply: 'Sure — happy to help.' });

    const inbound = await app.request(
      await signRequest(messageRequest(targetDid, 'hi'), privateKey, KEY_ID),
    );
    expect(inbound.status).toBe(201);
    const inboundMsgId = (await inbound.json()).message_id;

    // Nothing was held — the empty override did not perturb the allow path.
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

describe('A2A agent reply with KB tool calls + citations', () => {
  const KEY_ID = 'did:web:localhost#key-1';
  let restoreFetch: () => void;

  beforeEach(async () => {
    await ensureCollection();
    await ensureMemoryCollection();
  });

  afterEach(() => {
    restoreFetch?.();
    clearDIDCache();
  });

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

  // Give the user both an Anthropic key (chat provider) and an OpenAI key
  // (embeddings → enables KB search + recall).
  async function seedChatAndEmbeddingKeys(): Promise<void> {
    const env = getEnv();
    const anthropic = await encrypt('sk-test-anthropic', env.ENCRYPTION_KEY);
    const openai = await encrypt('sk-test-openai', env.ENCRYPTION_KEY);
    if (!anthropic.ok || !openai.ok) throw new Error('failed to encrypt test keys');
    await getDb()
      .update(users)
      .set({ llm_keys_json: { anthropic: anthropic.value, openai: openai.value } })
      .where(eq(users.id, user.id));
  }

  // A fixed unit vector so every embedded text (chunk, recall query, KB query)
  // collides → cosine 1.0, clearing the search threshold deterministically.
  function fixedVector(): number[] {
    const v = new Array(1536).fill(0);
    v[7] = 1;
    return v;
  }

  // Seed a KB row plus one Qdrant chunk owned by the user so search_knowledge_base
  // returns a citable hit. Returns the doc_name used for the citation assertion.
  async function seedKbChunk(docName: string, text: string): Promise<string> {
    const kbId = newId();
    await getDb().insert(knowledgeBases).values({ id: kbId, user_id: user.id, name: 'Ops KB' });
    await upsertChunks([
      {
        chunk_id: newId(),
        kb_id: kbId,
        kb_name: 'Ops KB',
        doc_id: newId(),
        doc_name: docName,
        user_id: user.id,
        text,
        chunk_index: 0,
        vector: fixedVector(),
      },
    ]);
    return docName;
  }

  test('answers a connected peer using KB search and persists citations', async () => {
    const targetDid = 'did:web:localhost:agents:kb';
    await seedTargetAgent(targetDid);
    await connectPeer('did:web:localhost');
    await seedChatAndEmbeddingKeys();
    const docName = await seedKbChunk('runbook.md', 'Our SLA target is 99.95% uptime.');

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

    // Round 0: ask for a KB search. Round 1: answer in text. Embeddings always
    // return the fixed vector so the chunk is found.
    let anthropicCall = 0;
    restoreFetch = mockFetch((url) => {
      if (url.includes('/.well-known/did.json')) return Response.json(didDocument);
      if (url.includes('api.openai.com')) {
        return Response.json({ data: [{ embedding: fixedVector(), index: 0 }] });
      }
      if (url.includes('api.anthropic.com')) {
        return anthropicCall++ === 0
          ? anthropicToolUseStream('search_knowledge_base', { query: 'SLA target' })
          : anthropicTextStream('Our SLA target is 99.95% uptime.');
      }
      return undefined;
    });

    const inbound = await app.request(
      await signRequest(messageRequest(targetDid, 'What is your SLA target?'), privateKey, KEY_ID),
    );
    expect(inbound.status).toBe(201);
    const inboundMsgId = (await inbound.json()).message_id;

    const reply = await waitFor(async () => {
      const [r] = await getDb()
        .select()
        .from(messages)
        .where(eq(messages.in_reply_to, inboundMsgId));
      return r;
    });
    expect(reply?.sender_type).toBe('own_agent');
    expect(reply?.content).toContain('99.95%');

    const citations = reply?.citations_json as Array<{ doc_name: string }> | null;
    expect(citations).toBeTruthy();
    expect(citations?.length).toBeGreaterThan(0);
    expect(citations?.some((c) => c.doc_name === docName)).toBe(true);
  });

  test('degrades gracefully with no embedding/tavily key: answers, no citations', async () => {
    const targetDid = 'did:web:localhost:agents:plain';
    await seedTargetAgent(targetDid);
    await connectPeer('did:web:localhost');
    // Only an Anthropic chat key — no OpenAI (embeddings) → no KB/recall/extract.
    await seedUserLlmKey();

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
      // No tool calls offered (no tavily, no KB) → a single plain-text turn.
      if (url.includes('api.anthropic.com')) return anthropicTextStream('Plain answer.');
      // Any stray embedding call would mean the degraded path wrongly tried KB.
      if (url.includes('api.openai.com')) return new Response('unexpected', { status: 500 });
      return undefined;
    });

    const inbound = await app.request(
      await signRequest(messageRequest(targetDid, 'hello there'), privateKey, KEY_ID),
    );
    expect(inbound.status).toBe(201);
    const inboundMsgId = (await inbound.json()).message_id;

    const reply = await waitFor(async () => {
      const [r] = await getDb()
        .select()
        .from(messages)
        .where(eq(messages.in_reply_to, inboundMsgId));
      return r;
    });
    expect(reply?.sender_type).toBe('own_agent');
    expect(reply?.content).toBe('Plain answer.');
    expect(reply?.citations_json).toBeNull();

    // No embedding key → nothing extracted into long-term memory.
    const memories = await getDb()
      .select()
      .from(agentMemories)
      .where(eq(agentMemories.user_id, user.id));
    expect(memories).toHaveLength(0);
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
