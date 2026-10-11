import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  clearDIDCache,
  generateEd25519KeyPair,
  publicKeyToMultibase,
  signRequest,
} from '@confer/identity';
import { newId } from '@confer/shared';
import { and, eq } from 'drizzle-orm';
import { TASK_STATES } from '../a2a/rest-model.js';
import { app } from '../app.js';
import { getDb } from '../db/connection.js';
import {
  agents,
  conversations,
  messages,
  peerAgents,
  peerContacts,
  permissions,
} from '../db/schema.js';
import { SIGNATURE_EXTENSION_URI } from '../lib/agent-card.js';
import { settleDetached } from '../lib/background.js';
import { clearNonceCache } from '../lib/nonce-cache.js';
import { mockFetch, post, resetDb, type SeededUser, seedUser } from '../test/helpers.js';

// The Linux Foundation A2A HTTP+JSON binding, driven the way a standard client
// would drive it: the spec's paths, the spec's request bodies, and a real RFC
// 9421 signature over each one. What is being checked is that a client written
// against the published standard — which cannot be adjusted to suit us — gets
// the responses the standard says it will.

const BASE = 'http://localhost/a2a/v1';
const PEER_DID = 'did:web:peer.example';
const PEER_KEY_ID = 'did:web:peer.example#key-1';
const OTHER_DID = 'did:web:other.example';
const OTHER_KEY_ID = 'did:web:other.example#key-1';

let user: SeededUser;
let restoreFetch: () => void;
let peerKey: CryptoKey;
let otherKey: CryptoKey;
// The DID documents the mocked network serves, by host — mutable, so a test
// can rotate a peer's key between two requests.
let docs: Record<string, unknown> = {};

function didDoc(did: string, keyId: string, publicKeyMultibase: string) {
  return {
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: did,
    verificationMethod: [
      { id: keyId, type: 'Ed25519VerificationKey2020', controller: did, publicKeyMultibase },
    ],
  };
}

beforeEach(async () => {
  await resetDb();
  clearDIDCache();
  clearNonceCache();
  user = await seedUser();

  const peer = await generateEd25519KeyPair();
  const other = await generateEd25519KeyPair();
  peerKey = peer.privateKey;
  otherKey = other.privateKey;

  docs = {
    'peer.example': didDoc(PEER_DID, PEER_KEY_ID, await publicKeyToMultibase(peer.publicKey)),
    'other.example': didDoc(OTHER_DID, OTHER_KEY_ID, await publicKeyToMultibase(other.publicKey)),
  };
  restoreFetch = mockFetch((url) => {
    for (const [needle, doc] of Object.entries(docs)) {
      if (url.includes(needle)) return Response.json(doc);
    }
    // No LLM key is configured in these fixtures, so a turn never gets this far;
    // failing loudly here beats a real outbound call if one ever did.
    if (url.includes('api.anthropic.com')) return new Response('{}', { status: 401 });
    return undefined;
  });
});

afterEach(() => {
  restoreFetch();
  clearDIDCache();
  clearNonceCache();
});

/** The seeded user's own agent, addressable by the tenant selector on its Card. */
async function seedAgent(policies: Record<string, unknown> = {}): Promise<string> {
  const id = newId();
  await getDb()
    .insert(agents)
    .values({
      id,
      user_id: user.id,
      did: `${user.did}:agent`,
      policies_json: policies,
      model_config_json: { provider: 'anthropic' },
      is_public: true,
    });
  return id;
}

async function connectPeer(did = PEER_DID): Promise<string> {
  const db = getDb();
  const peerId = newId();
  await db.insert(peerAgents).values({
    id: peerId,
    did,
    endpoint: 'https://peer.example/a2a/v1',
    public_key_json: {},
    agent_facts_json: {},
  });
  await db
    .insert(peerContacts)
    .values({ id: newId(), user_id: user.id, peer_id: peerId, added_via: 'manual' });
  return peerId;
}

interface CallOptions {
  key?: CryptoKey;
  keyId?: string;
  /** Omit the A2A-Extensions header, as a client unaware of the requirement would. */
  skipExtension?: boolean;
  version?: string;
}

let callCounter = 0;

/** A signed request in the shape a conformant client sends. */
async function call(
  method: string,
  path: string,
  body?: unknown,
  options: CallOptions = {},
): Promise<Response> {
  // A distinct client IP per call, as `test/helpers.ts` does: the per-IP limit
  // on /a2a is not what these tests exercise, and one shared address across a
  // whole file would trip it. Not a signed component, so the signature holds.
  const headers: Record<string, string> = {
    'content-type': 'application/a2a+json',
    'x-forwarded-for': `a2a-test-${++callCounter}`,
  };
  if (!options.skipExtension) headers['a2a-extensions'] = SIGNATURE_EXTENSION_URI;
  if (options.version) headers['a2a-version'] = options.version;

  const request = new Request(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const signed = await signRequest(request, options.key ?? peerKey, options.keyId ?? PEER_KEY_ID);
  return app.request(signed);
}

interface SendExtras {
  /** Merged into the `message` object — e.g. an echoed `contextId`. */
  message?: Record<string, unknown>;
  configuration?: Record<string, unknown>;
}

function sendBody(text: string, extra: SendExtras = {}) {
  return {
    tenant: user.username,
    message: {
      messageId: newId(),
      role: 'ROLE_USER',
      parts: [{ text }],
      ...extra.message,
    },
    ...(extra.configuration ? { configuration: extra.configuration } : {}),
  };
}

/** The same request with no `tenant`, as a client holding no Card would send it. */
function withoutTenant(body: ReturnType<typeof sendBody>) {
  return { message: body.message, configuration: body.configuration };
}

/** Non-blocking send, which is what most of these tests want. */
function sendNow(text: string, extra: SendExtras = {}) {
  return sendBody(text, {
    ...extra,
    configuration: { returnImmediately: true, ...extra.configuration },
  });
}

describe('binding preconditions', () => {
  test('refuses a client that did not declare the signature extension', async () => {
    // §3.3.4: a `required: true` extension the client has not declared MUST be
    // refused — and "you must implement RFC 9421" is a far more actionable
    // answer than the bare 401 the signature check alone would produce.
    await seedAgent();
    const res = await call('POST', '/message:send', sendNow('hi'), { skipExtension: true });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.details[0].reason).toBe('EXTENSION_SUPPORT_REQUIRED');
    expect(body.error.message).toContain(SIGNATURE_EXTENSION_URI);
  });

  test('refuses an unsupported protocol version', async () => {
    await seedAgent();
    const res = await call('POST', '/message:send', sendNow('hi'), { version: '0.3' });

    expect(res.status).toBe(400);
    expect((await res.json()).error.details[0].reason).toBe('VERSION_NOT_SUPPORTED');
  });

  test('accepts the version it implements', async () => {
    await seedAgent();
    await connectPeer();
    const res = await call('POST', '/message:send', sendNow('hi'), { version: '1.0' });
    expect(res.status).toBe(200);
  });

  // A peer that rotates sends its next message under a key our cached copy of
  // its document has never seen. Refusing that would break every peer's first
  // message after a rotation, until our cache happened to expire.
  test('accepts a peer that rotated its key while we held its old document', async () => {
    const did = 'did:web:rotating.example';
    const first = await generateEd25519KeyPair();
    docs['rotating.example'] = didDoc(
      did,
      `${did}#key-1`,
      await publicKeyToMultibase(first.publicKey),
    );
    await seedAgent();
    await connectPeer(did);
    const before = await call('POST', '/message:send', sendNow('before'), {
      key: first.privateKey,
      keyId: `${did}#key-1`,
    });
    expect(before.status).toBe(200);

    const next = await generateEd25519KeyPair();
    docs['rotating.example'] = didDoc(
      did,
      `${did}#key-2`,
      await publicKeyToMultibase(next.publicKey),
    );
    const after = await call('POST', '/message:send', sendNow('after'), {
      key: next.privateKey,
      keyId: `${did}#key-2`,
    });
    expect(after.status).toBe(200);
  });

  test("reports an unsigned request in the A2A error shape, not Confer's", async () => {
    // A standard client parses `error.details[].reason`; handing it Confer's own
    // `{error:{code}}` envelope would be an error it cannot read.
    await seedAgent();
    const res = await app.request(`${BASE}/message:send`, {
      method: 'POST',
      headers: {
        'content-type': 'application/a2a+json',
        'a2a-extensions': SIGNATURE_EXTENSION_URI,
      },
      body: JSON.stringify(sendNow('hi')),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.status).toBe('UNAUTHENTICATED');
    expect(body.error.details[0].reason).toBe('UNAUTHENTICATED');
  });

  test('answers with the binding media type', async () => {
    await seedAgent();
    await connectPeer();
    const res = await call('POST', '/message:send', sendNow('hi'));
    expect(res.headers.get('content-type')).toContain('application/a2a+json');
  });
});

describe('message:send', () => {
  test('creates a task an unconnected peer cannot start', async () => {
    // The consent gate is the whole product: a stranger must not be able to
    // spend the owner's model budget. No task is fabricated for them either —
    // a task id that 404s on the next call would be worse than an honest error.
    await seedAgent();
    const res = await call('POST', '/message:send', sendNow('hello'));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.details[0].reason).toBe('PERMISSION_DENIED');
    expect(body.error.details[0].metadata.confer_status).toBe('pending_connection');

    // …and the owner has a connection request to act on.
    const pending = await getDb()
      .select()
      .from(permissions)
      .where(eq(permissions.user_id, user.id));
    expect(pending.map((p) => p.action)).toContain('connect');
  });

  test('returns a well-formed Task for a connected peer', async () => {
    await seedAgent();
    await connectPeer();

    const res = await call('POST', '/message:send', sendNow('what is the plan?'));
    expect(res.status).toBe(200);

    const task = await res.json();
    expect(task.id).toHaveLength(26);
    expect(task.contextId).toHaveLength(26);
    expect(task.status.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(task.history[0]).toEqual({
      messageId: task.id,
      contextId: task.contextId,
      taskId: task.id,
      role: 'ROLE_USER',
      parts: [{ text: 'what is the plan?' }],
    });
    // Deliberately not asserted here: the state at this instant is a race. These
    // fixtures configure no LLM key, so the turn fails almost immediately and
    // `returnImmediately` truthfully reports whichever state it has reached.
    // The state machine itself is pinned below, on rows seeded directly.
    expect(TASK_STATES).toContain(task.status.state);
  });

  test('files a second message into the same context when the contextId is echoed', async () => {
    // The `contextId` handed back is what makes a conversation a conversation:
    // without it every message opens a thread of its own and the agent answers
    // each one as if it were the first.
    await seedAgent();
    await connectPeer();

    const first = await (await call('POST', '/message:send', sendNow('first'))).json();
    const second = await (
      await call(
        'POST',
        '/message:send',
        sendNow('second', { message: { contextId: first.contextId } }),
      )
    ).json();

    expect(second.contextId).toBe(first.contextId);
    expect(second.id).not.toBe(first.id);
  });

  test('reports a held question as AUTH_REQUIRED without waiting', async () => {
    // An `ask_user` policy interrupts the task rather than failing it, and a
    // BLOCKING call must still return: §3.2.2 says the wait ends at a terminal
    // *or interrupted* state, and nothing moves here until a human acts.
    await seedAgent({ default: 'ask_user' });
    await connectPeer();

    const res = await call('POST', '/message:send', sendBody('needs approval'));
    expect(res.status).toBe(200);
    expect((await res.json()).status.state).toBe('TASK_STATE_AUTH_REQUIRED');
  });

  test('refuses a request that will not accept text output', async () => {
    await seedAgent();
    await connectPeer();
    const res = await call(
      'POST',
      '/message:send',
      sendNow('hi', { configuration: { acceptedOutputModes: ['image/png'] } }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error.details[0].reason).toBe('CONTENT_TYPE_NOT_SUPPORTED');
  });

  test('refuses a non-text part instead of silently dropping it', async () => {
    await seedAgent();
    await connectPeer();
    const res = await call('POST', '/message:send', {
      tenant: user.username,
      message: {
        messageId: newId(),
        role: 'ROLE_USER',
        parts: [{ text: 'look at this' }, { url: 'https://example.com/a.pdf' }],
      },
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error.details[0].reason).toBe('CONTENT_TYPE_NOT_SUPPORTED');
  });

  // A webhook is called as given, so it gets the same check as a peer's A2A
  // endpoint: https, resolving to a public address. Refused before anything is
  // stored, so a bad one cannot leave behind a question nobody will hear about.
  test.each([
    'http://hooks.example/a2a',
    'https://127.0.0.1/a2a',
    'https://user:pw@hooks.example/a2a',
  ])('refuses a push webhook at %s', async (url) => {
    await seedAgent();
    await connectPeer();
    const res = await call(
      'POST',
      '/message:send',
      sendNow('hi', { configuration: { taskPushNotificationConfig: { url } } }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error.details[0].reason).toBe('INVALID_ARGUMENT');
    expect(await getDb().select().from(messages)).toHaveLength(0);
  });

  test('rejects a malformed request body', async () => {
    await seedAgent();
    await connectPeer();
    const res = await call('POST', '/message:send', { tenant: user.username, message: {} });

    expect(res.status).toBe(400);
    expect((await res.json()).error.details[0].reason).toBe('INVALID_ARGUMENT');
  });

  test('404s an unknown tenant without saying whether the account exists', async () => {
    await seedAgent();
    await connectPeer();
    const res = await call('POST', '/message:send', {
      ...sendNow('hi'),
      tenant: 'nobody-here',
    });

    expect(res.status).toBe(404);
    expect((await res.json()).error.details[0].reason).toBe('TASK_NOT_FOUND');
  });

  test('asks for a tenant when the instance serves more than one agent', async () => {
    await seedAgent();
    await connectPeer();
    const second = await seedUser();
    await getDb()
      .insert(agents)
      .values({
        id: newId(),
        user_id: second.id,
        did: `${second.did}:agent`,
        policies_json: {},
        is_public: true,
      });

    const res = await call('POST', '/message:send', withoutTenant(sendNow('hi')));

    expect(res.status).toBe(400);
    const error = (await res.json()).error;
    expect(error.details[0].reason).toBe('INVALID_ARGUMENT');
    expect(error.message).toContain('tenant');
  });

  test('addresses the only agent when there is no ambiguity', async () => {
    await seedAgent();
    await connectPeer();

    const res = await call('POST', '/message:send', withoutTenant(sendNow('hi')));
    expect(res.status).toBe(200);
  });
});

describe('tasks', () => {
  async function createTask(text = 'a question'): Promise<{ id: string; contextId: string }> {
    await seedAgent();
    await connectPeer();
    const task = await (await call('POST', '/message:send', sendNow(text))).json();
    return task;
  }

  test('reads back a task the caller created', async () => {
    const created = await createTask('remember this');
    const res = await call('GET', `/tasks/${created.id}`);

    expect(res.status).toBe(200);
    const task = await res.json();
    expect(task.id).toBe(created.id);
    expect(task.history[0].parts[0].text).toBe('remember this');
  });

  test("hides another peer's task rather than forbidding it", async () => {
    // §3.3.2: a server MUST NOT reveal the existence of a resource the client
    // cannot access. A 403 here would make this endpoint an id oracle.
    const created = await createTask('secret question');
    await connectPeer(OTHER_DID);

    const res = await call('GET', `/tasks/${created.id}`, undefined, {
      key: otherKey,
      keyId: OTHER_KEY_ID,
    });

    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain('secret question');
  });

  test('reports a completed turn with the answer in status.message', async () => {
    const created = await createTask('what is 2+2?');
    const [agent] = await getDb().select().from(agents).where(eq(agents.user_id, user.id));

    await getDb()
      .insert(messages)
      .values({
        id: newId(),
        conversation_id: created.contextId,
        sender_type: 'own_agent',
        sender_id: agent?.id ?? newId(),
        content_type: 'text',
        content: 'four',
        in_reply_to: created.id,
        via: 'a2a',
      });

    const task = await (await call('GET', `/tasks/${created.id}`)).json();
    expect(task.status.state).toBe('TASK_STATE_COMPLETED');
    expect(task.status.message.parts[0].text).toBe('four');
    expect(task.status.message.role).toBe('ROLE_AGENT');
    expect(task.history).toHaveLength(2);
  });

  test('reports a turn that could not run as FAILED, not WORKING', async () => {
    // The failure mode this project keeps rediscovering: a turn that only logs
    // is indistinguishable from one still in progress, so the client polls a
    // question that will never be answered. The notice row makes it terminal.
    const created = await createTask('unanswerable');
    const [agent] = await getDb().select().from(agents).where(eq(agents.user_id, user.id));

    await getDb()
      .insert(messages)
      .values({
        id: newId(),
        conversation_id: created.contextId,
        sender_type: 'own_agent',
        sender_id: agent?.id ?? newId(),
        content_type: 'system_notice',
        content: 'The agent you asked has no model configured yet.',
        content_json: { kind: 'a2a_turn_failed', error: 'no_model_configured' },
        in_reply_to: created.id,
        via: 'a2a',
      });

    const task = await (await call('GET', `/tasks/${created.id}`)).json();
    expect(task.status.state).toBe('TASK_STATE_FAILED');
  });

  test('the turn a send starts can be joined, so a truncate cannot land on it', async () => {
    // The turn runs detached from the request; the fixture has no model key, so
    // it ends in a notice row. `settleDetached` must see that row land — it is
    // what `resetDb` drains before truncating, and an untracked turn is the
    // deadlock class `lib/background.ts` exists for.
    await seedAgent();
    await connectPeer();
    const task = await (await call('POST', '/message:send', sendNow('hi'))).json();

    await settleDetached();

    const after = await (await call('GET', `/tasks/${task.id}`)).json();
    expect(after.status.state).toBe('TASK_STATE_FAILED');
  });

  test('honours historyLength', async () => {
    const created = await createTask('q');

    const none = await (await call('GET', `/tasks/${created.id}?historyLength=0`)).json();
    expect('history' in none).toBe(false);

    const some = await (await call('GET', `/tasks/${created.id}?historyLength=1`)).json();
    expect(some.history).toHaveLength(1);
  });

  test('404s an unknown task id', async () => {
    await seedAgent();
    await connectPeer();
    const res = await call('GET', `/tasks/${newId()}`);

    expect(res.status).toBe(404);
    expect((await res.json()).error.details[0].reason).toBe('TASK_NOT_FOUND');
  });

  test('lists only the calling peer own tasks', async () => {
    const created = await createTask('mine');
    await connectPeer(OTHER_DID);

    const mine = await (await call('GET', '/tasks')).json();
    expect(mine.tasks.map((t: { id: string }) => t.id)).toEqual([created.id]);
    expect(mine.pageSize).toBe(50);
    expect(mine.totalSize).toBe(1);
    // Always present, empty when there is no further page (§3.1.4).
    expect(mine.nextPageToken).toBe('');

    const theirs = await (
      await call('GET', '/tasks', undefined, { key: otherKey, keyId: OTHER_KEY_ID })
    ).json();
    expect(theirs.tasks).toHaveLength(0);
  });

  test('pages newest-first with a cursor', async () => {
    await seedAgent();
    await connectPeer();
    for (const text of ['one', 'two', 'three']) {
      await call('POST', '/message:send', sendNow(text));
    }

    const first = await (await call('GET', '/tasks?pageSize=2')).json();
    expect(first.tasks).toHaveLength(2);
    expect(first.totalSize).toBe(3);
    expect(first.nextPageToken).not.toBe('');
    expect(first.tasks[0].history[0].parts[0].text).toBe('three');

    const next = await (
      await call('GET', `/tasks?pageSize=2&pageToken=${first.nextPageToken}`)
    ).json();
    expect(next.tasks).toHaveLength(1);
    expect(next.tasks[0].history[0].parts[0].text).toBe('one');
    expect(next.nextPageToken).toBe('');
  });

  test('filters a listing by context', async () => {
    const created = await createTask('scoped');
    const other = await (await call('POST', '/message:send', sendNow('elsewhere'))).json();

    const listed = await (await call('GET', `/tasks?contextId=${created.contextId}`)).json();
    const ids = listed.tasks.map((t: { id: string }) => t.id);
    expect(ids).toContain(created.id);
    expect(ids).not.toContain(other.id);
  });
});

describe('operations this agent does not offer', () => {
  test('refuses to cancel a running turn', async () => {
    // §3.1.5 anticipates this: cancellation may be unsupported at the task's
    // current stage. Here that is every stage — a turn is one LLM call with no
    // interruption point, and the owner has already been billed for it.
    await seedAgent();
    await connectPeer();
    const task = await (await call('POST', '/message:send', sendNow('hi'))).json();

    const res = await call('POST', `/tasks/${task.id}:cancel`);
    expect(res.status).toBe(400);
    expect((await res.json()).error.details[0].reason).toBe('TASK_NOT_CANCELABLE');
  });

  test('404s a cancel for a task that is not the caller own', async () => {
    await seedAgent();
    await connectPeer();
    const res = await call('POST', `/tasks/${newId()}:cancel`);

    expect(res.status).toBe(404);
    expect((await res.json()).error.details[0].reason).toBe('TASK_NOT_FOUND');
  });

  test('names the operations it does support when the verb is unknown', async () => {
    await seedAgent();
    await connectPeer();
    const res = await call('POST', `/tasks/${newId()}:frobnicate`);

    expect(res.status).toBe(400);
    const error = (await res.json()).error;
    expect(error.details[0].reason).toBe('UNSUPPORTED_OPERATION');
    expect(error.message).toContain('cancel');
  });

  test('answers the capability error the spec names for an extended Card', async () => {
    // §3.3.4 does not allow a 404 here: a client that reads the Card knows the
    // operation exists and needs to be told which capability is missing.
    await seedAgent();
    await connectPeer();
    const res = await call('GET', '/extendedAgentCard');

    expect(res.status).toBe(400);
    expect((await res.json()).error.details[0].reason).toBe('UNSUPPORTED_OPERATION');
  });
});

/** The `StreamResponse` objects in an SSE body, in order (§11.7: one per `data:` line). */
async function streamEvents(res: Response): Promise<Array<Record<string, any>>> {
  expect(res.headers.get('content-type')).toStartWith('text/event-stream');
  return (await res.text())
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)));
}

describe('streaming', () => {
  test('message:stream sends the task first, then its settled status, then closes', async () => {
    // No model key in these fixtures, so the turn ends in a failure notice:
    // WORKING, then FAILED — the two events a client of this agent can see.
    await seedAgent();
    await connectPeer();
    const events = await streamEvents(await call('POST', '/message:stream', sendBody('hi')));

    // The failure is instant, so it can land before the first snapshot is read:
    // then the task itself is the one, settled event. Otherwise WORKING comes
    // first and a status update settles it.
    const first = events[0]?.task;
    expect(first.id).toBeTruthy();
    if (events.length === 1) {
      expect(first.status.state).toBe('TASK_STATE_FAILED');
      return;
    }
    expect(events).toHaveLength(2);
    expect(first.status.state).toBe('TASK_STATE_WORKING');
    expect(events[1]?.statusUpdate).toMatchObject({
      taskId: first.id,
      contextId: first.contextId,
      status: { state: 'TASK_STATE_FAILED' },
    });
  });

  // §11.7: the stream closes on an interrupted state too — only a person can
  // move a task out of AUTH_REQUIRED, and nobody should hold a socket for that.
  test('a held question streams its AUTH_REQUIRED task and closes', async () => {
    await seedAgent({ default: 'ask_user' });
    await connectPeer();
    const events = await streamEvents(await call('POST', '/message:stream', sendBody('hold')));

    expect(events).toHaveLength(1);
    expect(events[0]?.task.status.state).toBe('TASK_STATE_AUTH_REQUIRED');
  });

  test('a stream request goes through the same gates as a send', async () => {
    await seedAgent();
    const res = await call('POST', '/message:stream', sendBody('stranger'));
    expect(res.status).toBe(403);
    expect((await res.json()).error.details[0].reason).toBe('PERMISSION_DENIED');
  });

  // The proto says GET and the spec's tables say POST; both are served.
  test.each(['GET', 'POST'])('%s :subscribe opens with the current task', async (method) => {
    await seedAgent({ default: 'ask_user' });
    await connectPeer();
    const task = await (await call('POST', '/message:send', sendNow('hold'))).json();

    const events = await streamEvents(await call(method, `/tasks/${task.id}:subscribe`));
    expect(events[0]?.task.id).toBe(task.id);
    expect(events[0]?.task.status.state).toBe('TASK_STATE_AUTH_REQUIRED');
  });

  test('caps open streams per peer, and frees a slot when one closes', async () => {
    await seedAgent({ default: 'ask_user' });
    const peerId = await connectPeer();
    // Unanswered and ungated: WORKING, so each subscription stays open.
    const db = getDb();
    const convId = newId();
    await db
      .insert(conversations)
      .values({ id: convId, type: 'direct_agent_agent', created_by: user.id });
    const taskId = newId();
    await db.insert(messages).values({
      id: taskId,
      conversation_id: convId,
      sender_type: 'peer_agent',
      sender_id: peerId,
      sender_did: PEER_DID,
      content_type: 'text',
      content: 'open',
      thread_root: convId,
      via: 'a2a',
    });

    const open = await Promise.all(
      Array.from({ length: 5 }, () => call('GET', `/tasks/${taskId}:subscribe`)),
    );
    const sixth = await call('GET', `/tasks/${taskId}:subscribe`);
    expect(sixth.status).toBe(429);
    expect((await sixth.json()).error.details[0].reason).toBe('RESOURCE_EXHAUSTED');

    for (const res of open) await res.body?.cancel();
    // A cancelled stream notices on its next tick and gives its slot back.
    let again: Response | undefined;
    for (let i = 0; i < 20; i++) {
      await Bun.sleep(100);
      again = await call('GET', `/tasks/${taskId}:subscribe`);
      if (again.status === 200) break;
    }
    expect(again?.status).toBe(200);
    await again?.body?.cancel();
  });

  test(':subscribe refuses a finished task, and 404s one that is not the caller own', async () => {
    await seedAgent();
    await connectPeer();
    const task = await (await call('POST', '/message:send', sendNow('hi'))).json();
    await settleDetached();

    const finished = await call('POST', `/tasks/${task.id}:subscribe`);
    expect(finished.status).toBe(400);
    expect((await finished.json()).error.details[0].reason).toBe('UNSUPPORTED_OPERATION');

    const unknown = await call('GET', `/tasks/${newId()}:subscribe`);
    expect(unknown.status).toBe(404);
  });
});

describe('push notifications', () => {
  const HOOK = 'https://hooks.example/a2a?channel=7';
  let delivered: Array<{ headers: Headers; body: Record<string, any> }>;

  beforeEach(() => {
    delivered = [];
    const inner = restoreFetch;
    const restoreHooks = mockFetch((url, init) => {
      if (!url.startsWith('https://hooks.example/')) return undefined;
      delivered.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: 204 });
    });
    restoreFetch = () => {
      restoreHooks();
      inner();
    };
  });

  const register = (taskId: string, extra: Record<string, unknown> = {}) =>
    call('POST', `/tasks/${taskId}/pushNotificationConfigs`, { url: HOOK, ...extra });

  test('tells the webhook each state a task reaches, once, with the credentials it was given', async () => {
    await seedAgent({ default: 'ask_user' });
    await connectPeer();
    const task = await (await call('POST', '/message:send', sendNow('hold'))).json();

    const res = await register(task.id, {
      token: 'per-task-token',
      authentication: { scheme: 'Bearer', credentials: 'receiver-secret' },
    });
    expect(res.status).toBe(200);
    const config = await res.json();
    expect(config).toMatchObject({ taskId: task.id, url: HOOK });
    // What the receiver checks to trust a push is written, never read back.
    expect(config.token).toBeUndefined();
    expect(config.authentication).toEqual({ scheme: 'Bearer' });

    await settleDetached();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.body.task.status.state).toBe('TASK_STATE_AUTH_REQUIRED');
    expect(delivered[0]?.headers.get('authorization')).toBe('Bearer receiver-secret');
    expect(delivered[0]?.headers.get('content-type')).toBe('application/a2a+json');
    expect(delivered[0]?.headers.get('x-a2a-notification-token')).toBe('per-task-token');

    // The owner refuses: REJECTED reaches the webhook.
    const [held] = await getDb()
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.action, 'ask'));
    await post(`/api/v1/permissions/${held?.id}/decide`, {
      token: user.token,
      body: { decision: 'deny', scope: 'peer_action' },
    });
    await settleDetached();
    expect(delivered.map((d) => d.body.task.status.state)).toEqual([
      'TASK_STATE_AUTH_REQUIRED',
      'TASK_STATE_REJECTED',
    ]);
  });

  test('a config given on send hears the turn end', async () => {
    await seedAgent();
    await connectPeer();
    await call(
      'POST',
      '/message:send',
      sendNow('hi', { configuration: { taskPushNotificationConfig: { url: HOOK } } }),
    );
    await settleDetached();

    expect(delivered.at(-1)?.body.task.status.state).toBe('TASK_STATE_FAILED');
  });

  test('lists, reads and deletes configs, and only for the peer that made them', async () => {
    await seedAgent({ default: 'ask_user' });
    await connectPeer();
    await connectPeer(OTHER_DID);
    const task = await (await call('POST', '/message:send', sendNow('hold'))).json();
    const config = await (await register(task.id)).json();

    const listed = await (await call('GET', `/tasks/${task.id}/pushNotificationConfigs`)).json();
    expect(listed).toEqual({ configs: [config], nextPageToken: '' });
    const one = await call('GET', `/tasks/${task.id}/pushNotificationConfigs/${config.id}`);
    expect(await one.json()).toEqual(config);

    const asOther = { key: otherKey, keyId: OTHER_KEY_ID };
    expect(
      (await call('GET', `/tasks/${task.id}/pushNotificationConfigs`, undefined, asOther)).status,
    ).toBe(404);
    expect(
      (await call('POST', `/tasks/${task.id}/pushNotificationConfigs`, { url: HOOK }, asOther))
        .status,
    ).toBe(404);

    // Deleting is idempotent (§3.1.10), and the other peer's delete touches nothing.
    await call(
      'DELETE',
      `/tasks/${task.id}/pushNotificationConfigs/${config.id}`,
      undefined,
      asOther,
    );
    expect(
      (await call('GET', `/tasks/${task.id}/pushNotificationConfigs/${config.id}`)).status,
    ).toBe(200);
    for (let i = 0; i < 2; i++) {
      const gone = await call('DELETE', `/tasks/${task.id}/pushNotificationConfigs/${config.id}`);
      expect(gone.status).toBe(200);
    }
    expect(
      (await call('GET', `/tasks/${task.id}/pushNotificationConfigs/${config.id}`)).status,
    ).toBe(404);
  });

  // These become request headers at delivery, where a bad one would only fail
  // inside a retry loop, long after the peer could have been told.
  test.each([
    { authentication: { scheme: 'Bearer token', credentials: 'x' } },
    { authentication: { scheme: 'Bearer', credentials: 'a\r\nX-Injected: 1' } },
    { token: 'a\nb' },
  ])('refuses a config whose header values could not be sent: %j', async (extra) => {
    await seedAgent({ default: 'ask_user' });
    await connectPeer();
    const task = await (await call('POST', '/message:send', sendNow('hold'))).json();
    const res = await register(task.id, extra);
    expect(res.status).toBe(400);
    expect((await res.json()).error.details[0].reason).toBe('INVALID_ARGUMENT');
  });

  test('refuses a webhook that would reach this machine', async () => {
    await seedAgent({ default: 'ask_user' });
    await connectPeer();
    const task = await (await call('POST', '/message:send', sendNow('hold'))).json();
    const res = await call('POST', `/tasks/${task.id}/pushNotificationConfigs`, {
      url: 'https://127.0.0.1/hook',
    });
    expect(res.status).toBe(400);
  });
});

describe('the two bindings share one set of gates', () => {
  test('a task created over REST is the same row the native dialect sees', async () => {
    // If the bindings kept their own copies of the admission flow, this is where
    // they would drift — and the tenant checks are in that flow.
    await seedAgent();
    const peerId = await connectPeer();

    const task = await (await call('POST', '/message:send', sendNow('shared'))).json();

    const [row] = await getDb().select().from(messages).where(eq(messages.id, task.id));
    expect(row?.sender_type).toBe('peer_agent');
    expect(row?.sender_id).toBe(peerId);
    expect(row?.sender_did).toBe(PEER_DID);
    expect(row?.via).toBe('a2a');
    // The local conversation id, never the peer's own identifier.
    expect(row?.thread_root).toBe(task.contextId);

    const [conversation] = await getDb()
      .select()
      .from(conversations)
      .where(eq(conversations.id, task.contextId));
    expect(conversation?.created_by).toBe(user.id);
  });

  // Each question costs the owner a model turn; the IP limit in front of the
  // binding says nothing about who is asking, so the peer has a quota of its own.
  test('a peer past its question quota is told to come back later', async () => {
    await seedAgent();
    await connectPeer();
    for (let i = 0; i < 20; i++) {
      expect((await call('POST', '/message:send', sendNow(`q${i}`))).status).toBe(200);
    }
    const over = await call('POST', '/message:send', sendNow('one too many'));
    expect(over.status).toBe(429);
    expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await over.json()).error.details[0].reason).toBe('RESOURCE_EXHAUSTED');
    // Refused before anything was stored.
    expect(
      await getDb().select().from(messages).where(eq(messages.content, 'one too many')),
    ).toEqual([]);
  });

  test('a suspended agent is unreachable over REST too', async () => {
    const agentId = await seedAgent();
    await connectPeer();
    await getDb().update(agents).set({ status: 'suspended' }).where(eq(agents.id, agentId));

    const res = await call('POST', '/message:send', sendNow('hi'));
    expect(res.status).toBe(404);
  });
});

describe('owner approval reaches the task state machine', () => {
  test('a refused question becomes REJECTED, not a task stuck at WORKING', async () => {
    // The owner's decision is the only thing that can move a held task, and a
    // client polling one it will never get an answer to needs a terminal state
    // to stop on.
    await seedAgent({ default: 'ask_user' });
    await connectPeer();

    const task = await (await call('POST', '/message:send', sendBody('needs approval'))).json();
    expect(task.status.state).toBe('TASK_STATE_AUTH_REQUIRED');

    // Through the owner's real decide route: this used to write a `'denied'`
    // that the route never writes, and so pinned a mapping production could not
    // reach — a refused question really sat at WORKING forever.
    const [held] = await getDb()
      .select({ id: permissions.id })
      .from(permissions)
      .where(and(eq(permissions.user_id, user.id), eq(permissions.action, 'ask')));
    const decided = await post(`/api/v1/permissions/${held?.id}/decide`, {
      token: user.token,
      body: { decision: 'deny', scope: 'peer_action' },
    });
    expect(decided.status).toBe(200);

    const after = await (await call('GET', `/tasks/${task.id}`)).json();
    expect(after.status.state).toBe('TASK_STATE_REJECTED');
  });

  test('a question still awaiting approval keeps reporting AUTH_REQUIRED', async () => {
    await seedAgent({ default: 'ask_user' });
    await connectPeer();

    const task = await (await call('POST', '/message:send', sendBody('needs approval'))).json();
    const again = await (await call('GET', `/tasks/${task.id}`)).json();
    expect(again.status.state).toBe('TASK_STATE_AUTH_REQUIRED');
  });
});

describe('task state machine', () => {
  // Seeded directly rather than driven through `message:send`, because the agent
  // loop runs fire-and-forget: a turn that finishes between the write and the
  // read makes any assertion about an in-flight state a coin toss. What is being
  // pinned here is the mapping from rows to states, which is what a client
  // switches on.
  async function seedInbound(peerId: string): Promise<{ taskId: string; convId: string }> {
    const db = getDb();
    const convId = newId();
    await db
      .insert(conversations)
      .values({ id: convId, type: 'direct_agent_agent', created_by: user.id });
    const taskId = newId();
    await db.insert(messages).values({
      id: taskId,
      conversation_id: convId,
      sender_type: 'peer_agent',
      sender_id: peerId,
      sender_did: PEER_DID,
      content_type: 'text',
      content: 'still thinking?',
      thread_root: convId,
      via: 'a2a',
    });
    return { taskId, convId };
  }

  test('an unanswered question with no approval gate is WORKING', async () => {
    await seedAgent();
    const { taskId } = await seedInbound(await connectPeer());

    const task = await (await call('GET', `/tasks/${taskId}`)).json();
    expect(task.status.state).toBe('TASK_STATE_WORKING');
    // Interim states carry no status message: there is nothing true to say yet.
    expect(task.status.message).toBeUndefined();
  });

  // Deterministic, unlike a live turn: the task is WORKING when the stream
  // opens, and the answer is written while it is open.
  test(':subscribe streams a WORKING task through to its answer', async () => {
    const agentId = await seedAgent();
    const { taskId, convId } = await seedInbound(await connectPeer());
    // Awaited inside the callback: a drizzle query is a lazy thenable, and one
    // nobody awaits is never sent.
    setTimeout(async () => {
      await getDb().insert(messages).values({
        id: newId(),
        conversation_id: convId,
        sender_type: 'own_agent',
        sender_id: agentId,
        content_type: 'text',
        content: 'here it is',
        in_reply_to: taskId,
        via: 'a2a',
      });
    }, 300);

    const events = await streamEvents(await call('GET', `/tasks/${taskId}:subscribe`));
    expect(events).toHaveLength(2);
    expect(events[0]?.task.status.state).toBe('TASK_STATE_WORKING');
    expect(events[1]?.statusUpdate.status.state).toBe('TASK_STATE_COMPLETED');
    expect(events[1]?.statusUpdate.status.message.parts[0].text).toBe('here it is');
  });

  test('a moderator-hidden question is invisible even to the peer that sent it', async () => {
    await seedAgent();
    const { taskId } = await seedInbound(await connectPeer());
    await getDb()
      .update(messages)
      .set({ moderation_status: 'hidden' })
      .where(eq(messages.id, taskId));

    expect((await call('GET', `/tasks/${taskId}`)).status).toBe(404);
  });

  test('a moderator-hidden answer does not complete the task', async () => {
    // Otherwise moderation would be visible only as a task that COMPLETED with
    // an empty answer — worse than it plainly still being in progress.
    await seedAgent();
    const peerId = await connectPeer();
    const { taskId, convId } = await seedInbound(peerId);
    await getDb().insert(messages).values({
      id: newId(),
      conversation_id: convId,
      sender_type: 'own_agent',
      sender_id: newId(),
      content_type: 'text',
      content: 'moderated away',
      in_reply_to: taskId,
      moderation_status: 'hidden',
      via: 'a2a',
    });

    const task = await (await call('GET', `/tasks/${taskId}`)).json();
    expect(task.status.state).toBe('TASK_STATE_WORKING');
    expect(JSON.stringify(task)).not.toContain('moderated away');
  });

  test('filters a listing by state, and still counts the whole scope', async () => {
    await seedAgent();
    const peerId = await connectPeer();
    const working = await seedInbound(peerId);
    const answered = await seedInbound(peerId);
    await getDb().insert(messages).values({
      id: newId(),
      conversation_id: answered.convId,
      sender_type: 'own_agent',
      sender_id: newId(),
      content_type: 'text',
      content: 'yes',
      in_reply_to: answered.taskId,
      via: 'a2a',
    });

    const done = await (await call('GET', '/tasks?status=TASK_STATE_COMPLETED')).json();
    expect(done.tasks.map((t: { id: string }) => t.id)).toEqual([answered.taskId]);
    // A state is derived from other rows, so it cannot be a SQL predicate and
    // the filter runs after the page is read. `totalSize` therefore counts the
    // caller's tasks in scope BEFORE the filter — a client that reads it as
    // "matches" will page past the end.
    expect(done.totalSize).toBe(2);

    const inFlight = await (await call('GET', '/tasks?status=TASK_STATE_WORKING')).json();
    expect(inFlight.tasks.map((t: { id: string }) => t.id)).toEqual([working.taskId]);
  });

  test('a state this agent never enters lists empty rather than failing', async () => {
    // `TASK_STATES` carries every state the spec defines, not the subset this
    // agent emits, precisely so that asking about one of the others is an empty
    // page and not a validation error.
    await seedAgent();
    await seedInbound(await connectPeer());

    const response = await call('GET', '/tasks?status=TASK_STATE_CANCELED');
    expect(response.status).toBe(200);
    expect((await response.json()).tasks).toHaveLength(0);
  });

  test('ignores a status that is not a task state at all', async () => {
    // Unparseable query parameters are absent, not errors (§11.5) — the same
    // rule `historyLength` and `pageSize` follow.
    await seedAgent();
    const { taskId } = await seedInbound(await connectPeer());

    const listed = await (await call('GET', '/tasks?status=not-a-state')).json();
    expect(listed.tasks.map((t: { id: string }) => t.id)).toEqual([taskId]);
  });
});
