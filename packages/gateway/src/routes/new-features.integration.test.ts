import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  clearDIDCache,
  generateEd25519KeyPair,
  publicKeyToMultibase,
  signRequest,
} from '@confer/identity';
import { newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { admitInboundMessage } from '../a2a/inbound.js';
import { app } from '../app.js';
import { getDb } from '../db/connection.js';
import {
  agents,
  capabilityGrants,
  deviceAuthorizations,
  knowledgeBases,
  messages,
  peerAgents,
  peerContacts,
  permissions,
} from '../db/schema.js';
import { SIGNATURE_EXTENSION_URI } from '../lib/agent-card.js';
import { settleDetached } from '../lib/background.js';
import { capabilityScope } from '../lib/capability-grants.js';
import { clearNonceCache } from '../lib/nonce-cache.js';
import { outboundCapability } from '../lib/peer-credentials.js';
import {
  del,
  get,
  mockFetch,
  post,
  put,
  resetDb,
  type SeededUser,
  seedUser,
} from '../test/helpers.js';

let owner: SeededUser;
let other: SeededUser;
let restore: (() => void) | undefined;
beforeEach(async () => {
  await resetDb();
  clearDIDCache();
  clearNonceCache();
  owner = await seedUser();
  other = await seedUser();
});
afterEach(async () => {
  await settleDetached();
  restore?.();
  restore = undefined;
});
async function contact() {
  const id = newId();
  await getDb().insert(peerAgents).values({
    id,
    did: 'did:web:peer.example',
    name: 'Demo peer',
    public_key_json: {},
    agent_facts_json: {},
    endpoint: 'https://peer.example/a2a/v1',
  });
  await getDb()
    .insert(peerContacts)
    .values({ id: newId(), user_id: owner.id, peer_id: id, added_via: 'manual' });
  return id;
}
async function base(shared = true, user = owner) {
  const id = newId();
  await getDb()
    .insert(knowledgeBases)
    .values({ id, user_id: user.id, name: 'X100', shared_with_peers: shared });
  return id;
}
async function grant(peer: string, kb: string) {
  const res = await post('/api/v1/capabilities', {
    token: owner.token,
    body: {
      name: 'X100 only',
      peer_id: peer,
      signer_did: 'did:web:peer.example',
      kb_ids: [kb],
      expires_in_hours: 1,
    },
  });
  expect(res.status).toBe(201);
  return res.json() as Promise<{ token: string; grant: { id: string } }>;
}
async function apiCredential() {
  const res = await post('/api/v1/tokens', { token: owner.token, body: { name: 'script' } });
  return (await res.json()).token.token as string;
}

describe('receiver-issued capabilities', () => {
  test('scopes to owned shared KBs; binds signer, owner, peer, expiry and revocation', async () => {
    const peer = await contact();
    const kb = await base();
    const privateKb = await base(false);
    const foreignKb = await base(true, other);
    for (const invalid of [privateKb, foreignKb])
      expect(
        (
          await post('/api/v1/capabilities', {
            token: owner.token,
            body: {
              name: 'bad',
              peer_id: peer,
              signer_did: 'did:web:peer.example',
              kb_ids: [invalid],
              expires_in_hours: 1,
            },
          })
        ).status,
      ).toBe(400);
    const issued = await grant(peer, kb);
    expect(await capabilityScope(issued.grant.id, owner.id, peer)).toEqual([kb]);
    expect(await capabilityScope(issued.grant.id, other.id, peer)).toBeNull();
    const listed = await (await get('/api/v1/capabilities', { token: owner.token })).text();
    expect(listed).not.toContain(issued.token);
    expect(listed).not.toContain('token_hash');
    expect(
      (await del(`/api/v1/capabilities/${issued.grant.id}`, { token: other.token })).status,
    ).toBe(404);
    await getDb()
      .update(knowledgeBases)
      .set({ shared_with_peers: false })
      .where(eq(knowledgeBases.id, kb));
    expect(await capabilityScope(issued.grant.id, owner.id, peer)).toEqual([]);
    await del(`/api/v1/capabilities/${issued.grant.id}`, { token: owner.token });
    expect(await capabilityScope(issued.grant.id, owner.id, peer)).toBeNull();
  });
  test('stores a remote capability encrypted and never returns it', async () => {
    const peer = await contact();
    const issued = await grant(peer, await base());
    expect(
      (
        await put(`/api/v1/capabilities/remote/${peer}`, {
          token: owner.token,
          body: { token: issued.token },
        })
      ).status,
    ).toBe(200);
    expect(await outboundCapability(owner.id, peer)).toBe(issued.token);
    expect(await outboundCapability(other.id, peer)).toBeUndefined();
    expect(
      await (await get(`/api/v1/capabilities/remote/${peer}`, { token: owner.token })).json(),
    ).toEqual({ configured: true });
    await del(`/api/v1/capabilities/remote/${peer}`, { token: owner.token });
    expect(await outboundCapability(owner.id, peer)).toBeUndefined();
  });
  for (const binding of ['native', 'rest'] as const)
    test(`${binding}: real signatures, missing/expired/revoked tokens and held resumption`, async () => {
      const peer = await contact();
      const issued = await grant(peer, await base());
      await getDb()
        .insert(agents)
        .values({
          id: newId(),
          user_id: owner.id,
          did: `${owner.did}:agent`,
          is_public: true,
          policies_json: { default: 'ask_user' },
        });
      const key = await generateEd25519KeyPair();
      const keyId = 'did:web:peer.example#key-1';
      const doc = {
        '@context': ['https://www.w3.org/ns/did/v1'],
        id: 'did:web:peer.example',
        verificationMethod: [
          {
            id: keyId,
            type: 'Ed25519VerificationKey2020',
            controller: 'did:web:peer.example',
            publicKeyMultibase: await publicKeyToMultibase(key.publicKey),
          },
        ],
      };
      restore = mockFetch((url) => (url.includes('peer.example') ? Response.json(doc) : undefined));
      const send = async (credential?: string, signed = true) => {
        const path =
          binding === 'native'
            ? '/messages'
            : `/message:send?tenant=${encodeURIComponent(owner.username)}`;
        const body =
          binding === 'native'
            ? {
                from: 'did:web:peer.example',
                to: `${owner.did}:agent`,
                message: { type: 'question', content: 'X100 wiring?' },
              }
            : {
                message: {
                  messageId: newId(),
                  role: 'ROLE_USER',
                  parts: [{ text: 'X100 wiring?' }],
                },
              };
        const request = new Request(`http://localhost/a2a/v1${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'a2a-extensions': SIGNATURE_EXTENSION_URI,
            'x-forwarded-for': newId(),
            ...(credential ? { 'x-confer-capability': credential } : {}),
          },
          body: JSON.stringify(body),
        });
        return app.request(signed ? await signRequest(request, key.privateKey, keyId) : request);
      };
      expect((await send(issued.token, false)).status).toBe(401);
      expect((await send()).status).toBe(403);
      expect((await send(`cfc_${'x'.repeat(43)}`)).status).toBe(403);
      const good = await send(issued.token);
      expect([200, 202]).toContain(good.status);
      const [inbound] = await getDb().select().from(messages);
      expect(inbound?.capability_id).toBe(issued.grant.id);
      const [held] = await getDb().select().from(permissions);
      await del(`/api/v1/capabilities/${issued.grant.id}`, { token: owner.token });
      expect((await send(issued.token)).status).toBe(403);
      await post(`/api/v1/permissions/${held?.id}/decide`, {
        token: owner.token,
        body: { decision: 'allow_once', scope: 'peer_action' },
      });
      await settleDetached();
      const stored = await getDb().select().from(messages);
      expect(stored.find((m) => m.content_type === 'system_notice')?.content_json).toEqual({
        kind: 'a2a_turn_failed',
        error: 'capability_expired',
      });
      await getDb()
        .update(capabilityGrants)
        .set({ revoked_at: null, expires_at: new Date(Date.now() - 1000) })
        .where(eq(capabilityGrants.id, issued.grant.id));
      expect((await send(issued.token)).status).toBe(403);
    });
});

describe('browser-confirmed device authorization', () => {
  const start = async () =>
    (await post('/api/v1/device-auth/start', { body: { name: 'My editor' } })).json() as Promise<{
      device_code: string;
      user_code: string;
    }>;
  test('pending → browser approval → one exchange → revocable script credential', async () => {
    const request = await start();
    expect((await post('/api/v1/device-auth/token', { body: request })).status).toBe(202);
    expect(
      (
        await post('/api/v1/device-auth/decide', {
          token: await apiCredential(),
          body: { user_code: request.user_code, approve: true },
        })
      ).status,
    ).toBe(403);
    expect(
      (await post('/api/v1/device-auth/request', { token: owner.token, body: request })).status,
    ).toBe(200);
    expect(
      (
        await post('/api/v1/device-auth/decide', {
          token: owner.token,
          body: { user_code: request.user_code, approve: true },
        })
      ).status,
    ).toBe(200);
    const [one, two] = await Promise.all([
      post('/api/v1/device-auth/token', { body: request }),
      post('/api/v1/device-auth/token', { body: request }),
    ]);
    expect([one.status, two.status].sort()).toEqual([200, 400]);
    const credential = await (one.status === 200 ? one : two).json();
    expect(credential.username).toBe(owner.username);
    expect((await get('/api/v1/users/me', { token: credential.token })).status).toBe(200);
    expect(
      (
        await post('/api/v1/device-auth/decide', {
          token: credential.token,
          body: { user_code: request.user_code, approve: true },
        })
      ).status,
    ).toBe(403);
  });
  test('deny, expiry and another browser cannot claim an already approved request', async () => {
    const a = await start();
    await post('/api/v1/device-auth/decide', {
      token: owner.token,
      body: { user_code: a.user_code, approve: false },
    });
    expect((await post('/api/v1/device-auth/token', { body: a })).status).toBe(400);
    const b = await start();
    await getDb()
      .update(deviceAuthorizations)
      .set({ expires_at: new Date(0) });
    expect(
      (
        await post('/api/v1/device-auth/decide', {
          token: owner.token,
          body: { user_code: b.user_code, approve: true },
        })
      ).status,
    ).toBe(404);
    const c = await start();
    await post('/api/v1/device-auth/decide', {
      token: owner.token,
      body: { user_code: c.user_code, approve: true },
    });
    expect(
      (
        await post('/api/v1/device-auth/decide', {
          token: other.token,
          body: { user_code: c.user_code, approve: true },
        })
      ).status,
    ).toBe(404);
  });
});

describe('task progress and project snapshots', () => {
  test('takeover blocks operator actions, session-only resume, durable timeline and terminal state', async () => {
    const admin = await seedUser(undefined, { role: 'admin' });
    const task = await (
      await post('/api/v1/errands', { token: owner.token, body: { title: 'Contact vendor' } })
    ).json();
    const progress = (token: string, status: string) =>
      post(`/api/v1/errands/${task.id}/progress`, {
        token,
        body: { status, note: 'Contacting X100 vendor' },
      });
    expect((await progress(other.token, 'completed')).status).toBe(404);
    expect((await progress(admin.token, 'waiting_peer')).status).toBe(200);
    expect((await progress(owner.token, 'human_control')).status).toBe(200);
    expect((await progress(admin.token, 'in_progress')).status).toBe(403);
    expect((await progress(await apiCredential(), 'in_progress')).status).toBe(403);
    expect(
      (
        await post(`/api/v1/errands/${task.id}/cards`, {
          token: admin.token,
          body: { kind: 'approve', summary: 'pay', expires_at: new Date(Date.now() + 60000) },
        })
      ).status,
    ).toBe(409);
    expect((await progress(owner.token, 'in_progress')).status).toBe(200);
    expect((await progress(owner.token, 'completed')).status).toBe(200);
    expect((await progress(owner.token, 'in_progress')).status).toBe(409);
    const detail = await (await get(`/api/v1/errands/${task.id}`, { token: owner.token })).json();
    expect(detail.events).toHaveLength(5);
    expect(detail.errand.completed_at).toBeTruthy();
  });
  test('atomic memory snapshots reject stale and cross-owner writes', async () => {
    const peer = await contact();
    const path = `/api/v1/projects/x100/peers/${peer}/memory`;
    const payload = {
      facts_md: '# Facts\n24V',
      decisions_md: '# Decisions\nApproved',
      expected_version: 0,
    };
    expect((await put(path, { token: other.token, body: payload })).status).toBe(403);
    const [a, b] = await Promise.all([
      put(path, { token: owner.token, body: payload }),
      put(path, { token: owner.token, body: payload }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await (await get(path, { token: owner.token })).json()).toEqual({
      facts_md: payload.facts_md,
      decisions_md: payload.decisions_md,
      version: 1,
    });
    expect(await (await get(path, { token: other.token })).json()).toEqual({
      facts_md: '',
      decisions_md: '',
      version: 0,
    });
  });
});

test('an older unscoped held question cannot regain broad access after a scoped grant is issued', async () => {
  const peerId = await contact();
  const id = newId();
  await getDb()
    .insert(agents)
    .values({
      id,
      user_id: owner.id,
      did: `${owner.did}:agent`,
      policies_json: { default: 'ask_user' },
    });
  const [targetAgent] = await getDb().select().from(agents).where(eq(agents.id, id));
  if (!targetAgent) throw new Error('missing agent fixture');
  const admitted = await admitInboundMessage({
    targetAgent,
    senderDid: 'did:web:peer.example',
    signerDid: 'did:web:peer.example',
    message: { type: 'question', content: 'Old question' },
  });
  expect(admitted.status).toBe('held');
  await grant(peerId, await base());
  const [held] = await getDb().select().from(permissions);
  expect(
    (
      await post(`/api/v1/permissions/${held?.id}/decide`, {
        token: owner.token,
        body: { decision: 'allow_once', scope: 'peer_action' },
      })
    ).status,
  ).toBe(200);
  await settleDetached();
  const rows = await getDb().select().from(messages);
  expect(rows.find((m) => m.content_type === 'system_notice')?.content_json).toEqual({
    kind: 'a2a_turn_failed',
    error: 'capability_expired',
  });
});
