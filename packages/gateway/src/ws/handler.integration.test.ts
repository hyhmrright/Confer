import { beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import type { Server } from 'bun';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import {
  conversationParticipants,
  conversations,
  peerAgents,
  peerContacts,
  sessions,
  users,
} from '../db/schema.js';
import { mintToken, resetDb, type SeededUser, seedUser } from '../test/helpers.js';
import {
  broadcastToConversation,
  disconnectUser,
  getPresenceAudience,
  websocket,
} from './handler.js';

let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

// Record that `owner` added the agent identified by `targetDid` as a contact.
async function addContact(ownerId: string, targetDid: string): Promise<void> {
  const db = getDb();
  const peerId = newId();
  await db.insert(peerAgents).values({
    id: peerId,
    did: targetDid,
    endpoint: 'https://localhost/a2a/v1',
    public_key_json: {},
    agent_facts_json: {},
  });
  await db
    .insert(peerContacts)
    .values({ id: newId(), user_id: ownerId, peer_id: peerId, added_via: 'manual' });
}

// A socket is a read channel over the same data the REST API serves, so the
// upgrade gets the same door. It had a third of one: a valid signature and
// nothing else. Each case below passed before this was fixed.
describe('websocket.upgrade authentication', () => {
  // `server.upgrade` is the only thing the handler needs from Bun's Server, and
  // returning true is what a real one does on success. Driving the exported
  // `websocket.upgrade` rather than the internal check keeps the test on the
  // path production actually takes, connection cap and all.
  const fakeServer = { upgrade: () => true } as unknown as Server<unknown>;

  const upgradeWith = (token: string) =>
    websocket.upgrade(
      new Request(`http://localhost/ws?token=${token}`, {
        headers: { upgrade: 'websocket' },
      }),
      fakeServer,
    );

  test('accepts a live access token', async () => {
    expect(await upgradeWith(user.token)).toBeUndefined();
  });

  test('rejects a refresh token', async () => {
    // The two differed only in `exp`, so this opened a socket that outlived its
    // access token by ninety days.
    const refresh = await mintToken(user.id, user.username, {
      sid: user.sessionId,
      typ: 'refresh',
      expiresIn: '90d',
    });
    expect((await upgradeWith(refresh))?.status).toBe(401);
  });

  test('rejects a token with no session id', async () => {
    const noSid = await mintToken(user.id, user.username);
    expect((await upgradeWith(noSid))?.status).toBe(401);
  });

  test('rejects a token whose session has been revoked', async () => {
    // What logout does, and what disabling an account does to every session.
    await getDb().delete(sessions).where(eq(sessions.id, user.sessionId));
    expect((await upgradeWith(user.token))?.status).toBe(401);
  });

  test('rejects a disabled account', async () => {
    await getDb().update(users).set({ status: 'disabled' }).where(eq(users.id, user.id));
    expect((await upgradeWith(user.token))?.status).toBe(401);
  });

  test('rejects a token signed with the wrong secret', async () => {
    expect((await upgradeWith('not.a.token'))?.status).toBe(401);
  });
});

// A stand-in for Bun's ServerWebSocket carrying just what the handler touches:
// the per-socket data, `send`, and a `close` that behaves like a real one by
// running the close handler.
//
// It deliberately starts with NO subscriptions. Handing it a pre-filled set
// would fill `ws.data.subscriptions` while leaving the broadcast index empty,
// and a socket that half-exists is exactly the state the index is supposed to
// make impossible — a fixture doing it would be testing a state production
// cannot reach. Subscribe through `subscribeTo` instead.
function fakeSocket(seeded: SeededUser) {
  const sent: string[] = [];
  const state = { closed: false };
  const ws = {
    data: {
      user: { sub: seeded.id, username: seeded.username, sid: seeded.sessionId },
      subscriptions: new Set<string>(),
    },
    send: (payload: string) => sent.push(payload),
    close: () => {
      state.closed = true;
      websocket.close(ws as never);
    },
  };
  return { sent, state, ws };
}

// A conversation `ownerId` is a participant of, which is what the subscribe
// gate checks.
async function seedConversation(ownerId: string): Promise<string> {
  const convId = newId();
  const db = getDb();
  await db
    .insert(conversations)
    .values({ id: convId, type: 'direct_user_agent', created_by: ownerId });
  await db.insert(conversationParticipants).values({
    id: newId(),
    conversation_id: convId,
    participant_type: 'user',
    user_id: ownerId,
    role: 'owner',
  });
  return convId;
}

// Subscribe the way a client does — over the socket — and wait for the gate to
// let it through. `websocket.message` dispatches the authorization without
// awaiting it (it is a sync handler), so the frame alone proves nothing.
async function subscribeTo(
  ws: { data: { subscriptions: Set<string> } },
  conversationId: string,
): Promise<void> {
  websocket.message(
    ws as never,
    JSON.stringify({ type: 'subscribe.conversation', data: { conversation_id: conversationId } }),
  );
  for (let i = 0; i < 100 && !ws.data.subscriptions.has(conversationId); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('conversation subscription', () => {
  test('admits a participant', async () => {
    const convId = await seedConversation(user.id);
    const socket = fakeSocket(user);

    await subscribeTo(socket.ws, convId);

    expect(socket.ws.data.subscriptions.has(convId)).toBe(true);
  });

  // `subscriptions` is the sole gate `broadcastToConversation` consults, so an
  // unchecked subscribe would hand any authenticated user the message stream of
  // any conversation whose id they learn.
  test('refuses someone who is neither participant nor creator', async () => {
    const convId = await seedConversation(user.id);
    const outsider = await seedUser();
    const socket = fakeSocket(outsider);

    await subscribeTo(socket.ws, convId);

    expect(socket.ws.data.subscriptions.has(convId)).toBe(false);
    expect(socket.sent.some((m) => m.includes('Not a participant'))).toBe(true);
  });

  // Broadcasts are served from an index of sockets per conversation rather than
  // by walking everyone online and asking. Two structures holding the same
  // sockets can drift, and drift here means a socket that unsubscribed — or
  // closed — keeps receiving. These two are the check that they don't.
  test('unsubscribing stops the broadcast', async () => {
    const convId = await seedConversation(user.id);
    const other = await seedUser();
    await getDb().insert(conversationParticipants).values({
      id: newId(),
      conversation_id: convId,
      participant_type: 'user',
      user_id: other.id,
      role: 'member',
    });
    const listener = fakeSocket(other);
    websocket.open(listener.ws as never);
    await subscribeTo(listener.ws, convId);

    websocket.message(
      listener.ws as never,
      JSON.stringify({ type: 'unsubscribe.conversation', data: { conversation_id: convId } }),
    );
    broadcastToConversation(convId, { type: 'message.new', data: { id: 'm1' } } as never);
    websocket.close(listener.ws as never);

    expect(listener.sent).toHaveLength(0);
  });

  test('closing stops the broadcast', async () => {
    const convId = await seedConversation(user.id);
    const listener = fakeSocket(user);
    websocket.open(listener.ws as never);
    await subscribeTo(listener.ws, convId);
    websocket.close(listener.ws as never);

    broadcastToConversation(convId, { type: 'message.new', data: { id: 'm1' } } as never);

    expect(listener.sent).toHaveLength(0);
  });
});

// Subscribing is gated; sending a typing event was not. A conversation id was
// the only thing needed to inject "X is typing…" — under your own username —
// into a thread you have no part in.
describe('typing events', () => {
  const typingFrame = (conversationId: string) =>
    JSON.stringify({ type: 'typing.start', data: { conversation_id: conversationId } });

  // The broadcast excludes the sender's own user, so the listener has to be
  // someone else for either case to prove anything.
  test('reaches a subscriber of the same conversation', async () => {
    const convId = await seedConversation(user.id);
    const other = await seedUser();
    await getDb().insert(conversationParticipants).values({
      id: newId(),
      conversation_id: convId,
      participant_type: 'user',
      user_id: other.id,
      role: 'member',
    });

    const sender = fakeSocket(user);
    const listener = fakeSocket(other);
    websocket.open(listener.ws as never);
    await subscribeTo(sender.ws, convId);
    await subscribeTo(listener.ws, convId);

    websocket.message(sender.ws as never, typingFrame(convId));
    websocket.close(listener.ws as never);

    expect(listener.sent.some((m) => m.includes('typing.update'))).toBe(true);
  });

  test('is dropped when the sender has not subscribed to that conversation', async () => {
    const convId = await seedConversation(user.id);
    const other = await seedUser();
    await getDb().insert(conversationParticipants).values({
      id: newId(),
      conversation_id: convId,
      participant_type: 'user',
      user_id: other.id,
      role: 'member',
    });

    const outsider = fakeSocket(user);
    const listener = fakeSocket(other);
    websocket.open(listener.ws as never);
    await subscribeTo(listener.ws, convId);

    // The sender never subscribed — it is only claiming a conversation id.
    websocket.message(outsider.ws as never, typingFrame(convId));
    websocket.close(listener.ws as never);

    expect(listener.sent.some((m) => m.includes('typing.update'))).toBe(false);
  });
});

// Refusing the next upgrade does not reach a socket that is already open, and
// /ws is proxied with a one-day read timeout — so a ban applied a minute after
// someone connected would not have interrupted them.
describe('disconnectUser', () => {
  test('closes every socket the user holds and leaves others alone', async () => {
    const other = await seedUser();
    const first = fakeSocket(user);
    const second = fakeSocket(user);
    const bystander = fakeSocket(other);

    websocket.open(first.ws as never);
    websocket.open(second.ws as never);
    websocket.open(bystander.ws as never);

    disconnectUser(user.id);

    expect(first.state.closed).toBe(true);
    expect(second.state.closed).toBe(true);
    expect(bystander.state.closed).toBe(false);

    websocket.close(bystander.ws as never);
  });

  test('is a no-op for a user with no sockets', () => {
    expect(() => disconnectUser(user.id)).not.toThrow();
  });
});

describe('getPresenceAudience', () => {
  test('returns the users who added this user, not the ones this user added', async () => {
    const follower = await seedUser('follower');
    const followed = await seedUser('followed');

    // follower added `user`; `user` added `followed`.
    await addContact(follower.id, user.did);
    await addContact(user.id, followed.did);

    const audience = await getPresenceAudience(user.id);

    expect(audience).toEqual([follower.id]);
  });

  test('returns an empty list when nobody added this user', async () => {
    const followed = await seedUser('followed');
    await addContact(user.id, followed.did);

    expect(await getPresenceAudience(user.id)).toEqual([]);
  });
});
