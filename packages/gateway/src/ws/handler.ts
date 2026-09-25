import { type WsServerMessage, wsClientMessageSchema } from '@confer/shared';
import type { Server, ServerWebSocket } from 'bun';
import { and, eq } from 'drizzle-orm';
import * as jose from 'jose';
import { getDb } from '../db/connection.js';
import {
  conversationParticipants,
  peerAgents,
  peerContacts,
  sessions,
  users,
} from '../db/schema.js';
import { getEnv } from '../env.js';
import { runDetached } from '../lib/background.js';
import { isConversationParticipant, ownsConversation } from '../lib/tenant.js';
import { type AuthPayload, jwtSecret, TOKEN_TYPE } from '../middleware/auth.js';

export interface WsData {
  user: AuthPayload;
  subscriptions: Set<string>;
  /** When the access token this socket was opened with expires, in epoch ms. */
  expiresAt: number;
  expiryTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Close code for a socket whose access token has expired. The client renews
 * its token before reconnecting, rather than retrying with the one just
 * refused.
 */
export const WS_TOKEN_EXPIRED = 4001;

// Process-local: a socket is only reachable from the instance that accepted it.
// This is one of the three things that pin the gateway to a single replica (with
// `lib/nonce-cache.ts` and `middleware/rate-limit.ts`) — see docs/02-architecture.md.
const connectionsByUser = new Map<string, Set<ServerWebSocket<WsData>>>();

// The same sockets, indexed the way a broadcast asks for them. Delivering a
// message used to walk every socket of every connected user and ask each one
// whether it cared — work proportional to everyone online, on the hot path of
// every message and every keystroke of every typing indicator. A thread with
// two people in it should cost two sends.
//
// Two structures holding the same sockets can drift, so nothing outside
// `subscribe`/`unsubscribe`/`forget` touches either: they are the only writers,
// and they always write both.
const socketsByConversation = new Map<string, Set<ServerWebSocket<WsData>>>();

// Cap concurrent sockets per user (docs/05-api.md: "单用户最多 10 个并发连接").
const MAX_CONNECTIONS_PER_USER = 10;

function subscribe(ws: ServerWebSocket<WsData>, conversationId: string): void {
  ws.data.subscriptions.add(conversationId);
  let set = socketsByConversation.get(conversationId);
  if (!set) {
    set = new Set();
    socketsByConversation.set(conversationId, set);
  }
  set.add(ws);
}

function unsubscribe(ws: ServerWebSocket<WsData>, conversationId: string): void {
  ws.data.subscriptions.delete(conversationId);
  const set = socketsByConversation.get(conversationId);
  if (!set) return;
  set.delete(ws);
  // Drop the empty set: a conversation nobody is watching must not leave an
  // entry behind, or the index grows once per conversation ever opened.
  if (set.size === 0) socketsByConversation.delete(conversationId);
}

/** Drop a closing socket from every conversation it was watching. */
function forget(ws: ServerWebSocket<WsData>): void {
  for (const conversationId of [...ws.data.subscriptions]) {
    unsubscribe(ws, conversationId);
  }
}

export function broadcastToConversation(
  conversationId: string,
  message: WsServerMessage,
  exclude?: string,
): void {
  const subscribers = socketsByConversation.get(conversationId);
  if (!subscribers) return;
  const payload = JSON.stringify(message);
  for (const ws of subscribers) {
    if (ws.data.user.sub === exclude) continue;
    ws.send(payload);
  }
}

export function sendToUser(userId: string, message: WsServerMessage): void {
  const connections = connectionsByUser.get(userId);
  if (!connections) return;
  const payload = JSON.stringify(message);
  for (const ws of connections) {
    ws.send(payload);
  }
}

function sendError(ws: ServerWebSocket<WsData>, message: string): void {
  ws.send(JSON.stringify({ type: 'error', data: { message } }));
}

/**
 * Authenticate a socket the way every other authenticated surface does.
 *
 * A valid signature was the whole of the check here, and that is three gates
 * short of what `authMiddleware` applies to a REST call. None of the three is
 * theoretical:
 *
 *   - No token-type check, so a REFRESH token opened a socket. Those live 90
 *     days.
 *   - No account-status check, so an admin disabling an account stopped its
 *     REST calls and nothing else.
 *   - No session check, so logging out — or an admin deleting every session,
 *     which is exactly what disabling does — revoked nothing here.
 *
 * Together they mean a banned user reconnected at will and kept receiving every
 * `message.new` for their conversations, for as long as the token had left. The
 * socket is a read channel over the same data the REST API serves; it gets the
 * same door.
 */
async function authenticateUpgrade(
  req: Request,
): Promise<{ user: AuthPayload; expiresAt: number } | null> {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) return null;

  const env = getEnv();
  const secret = jwtSecret();

  let sub: string;
  let username: string;
  let sid: string;
  let expiresAt: number;
  try {
    const { payload } = await jose.jwtVerify(token, secret, { issuer: env.JWT_ISSUER });
    if (payload.typ !== TOKEN_TYPE.access) return null;
    if (typeof payload.sid !== 'string' || typeof payload.exp !== 'number') return null;
    sub = payload.sub as string;
    username = payload.username as string;
    sid = payload.sid;
    expiresAt = payload.exp * 1000;
  } catch {
    return null;
  }

  if (!(await sessionIsLive(sub, sid))) return null;
  return { user: { sub, username, sid }, expiresAt };
}

/** The account is enabled and the session behind the token still exists. */
async function sessionIsLive(userId: string, sid: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row || row.status === 'disabled') return false;

  const [session] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, sid))
    .limit(1);
  return session !== undefined;
}

// A logout or ban that lands between the upgrade's check and the socket being
// registered finds nothing to close, so the socket looks again once it is.
async function closeIfRevoked(ws: ServerWebSocket<WsData>): Promise<void> {
  const { sub, sid } = ws.data.user;
  if (!sid || !(await sessionIsLive(sub, sid))) ws.close(1008, 'Session revoked');
}

/**
 * Close every socket this user holds.
 *
 * Refusing the next upgrade is not enough on its own: `proxy_read_timeout` on
 * /ws is a day, and nothing obliges a client to reconnect. A socket opened one
 * minute before a ban would have gone on delivering messages indefinitely, so
 * the ban has to reach the sockets that are already open.
 */
export function disconnectUser(userId: string): void {
  const connections = connectionsByUser.get(userId);
  if (!connections) return;
  // Copy first: `close` fires the handler below, which mutates this set.
  for (const ws of [...connections]) {
    ws.close(1008, 'Session revoked');
  }
}

/**
 * Close the sockets opened under one session — what logging out of one device,
 * or refresh-token reuse detection, revokes. Deleting the session row stops the
 * next upgrade and nothing already open, the same gap `disconnectUser` closes
 * for a ban: a socket opened with a stolen token went on receiving the victim's
 * messages after they had logged out.
 */
export function disconnectSession(userId: string, sid: string): void {
  const connections = connectionsByUser.get(userId);
  if (!connections) return;
  for (const ws of [...connections]) {
    if (ws.data.user.sid === sid) ws.close(1008, 'Session revoked');
  }
}

export const websocket = {
  async upgrade(req: Request, server: Server<unknown>): Promise<Response | undefined> {
    const auth = await authenticateUpgrade(req);
    if (!auth) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Per-user connection cap. Only user-scoped: /ws has no XFF, so every user
    // shares nginx's upstream IP and an IP-based cap would throttle collectively.
    const existing = connectionsByUser.get(auth.user.sub);
    if (existing && existing.size >= MAX_CONNECTIONS_PER_USER) {
      return new Response('Too many connections', { status: 429 });
    }

    const success = server.upgrade(req, {
      data: {
        user: auth.user,
        subscriptions: new Set<string>(),
        expiresAt: auth.expiresAt,
      } satisfies WsData,
    });
    if (success) return undefined;
    return new Response('WebSocket upgrade failed', { status: 500 });
  },

  open(ws: ServerWebSocket<WsData>) {
    const userId = ws.data.user.sub;
    let set = connectionsByUser.get(userId);
    if (!set) {
      set = new Set();
      connectionsByUser.set(userId, set);
    }
    set.add(ws);

    // The token was checked once, at the upgrade, and then vouched for the
    // socket for as long as the connection lasted — a day, by nginx's read
    // timeout — though it was good for fifteen minutes. The socket ends when
    // the token does; the client renews it and reconnects.
    ws.data.expiryTimer = setTimeout(
      () => ws.close(WS_TOKEN_EXPIRED, 'Token expired'),
      Math.max(0, ws.data.expiresAt - Date.now()),
    );

    // `open`, `message` and `close` are synchronous, so the database work they
    // start is detached by construction. `runDetached` keeps the promise so a
    // test's `resetDb` can join it rather than truncate over it.
    runDetached(closeIfRevoked(ws), (e) => console.error('session recheck failed:', e));
    runDetached(broadcastPresence(userId, ws.data.user.username, true), (e) =>
      console.error('presence broadcast failed:', e),
    );
  },

  message(ws: ServerWebSocket<WsData>, raw: string | Buffer) {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      sendError(ws, 'Invalid JSON');
      return;
    }

    const result = wsClientMessageSchema.safeParse(parsed);
    if (!result.success) {
      sendError(ws, 'Invalid message format');
      return;
    }

    const msg = result.data;
    switch (msg.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', data: {} }));
        break;

      case 'subscribe.conversation':
        runDetached(authorizeSubscription(ws, msg.data.conversation_id), (e) =>
          console.error('subscription authorization failed:', e),
        );
        break;

      case 'unsubscribe.conversation':
        unsubscribe(ws, msg.data.conversation_id);
        break;

      case 'typing.start':
      case 'typing.stop':
        // Subscribing is gated (`authorizeSubscription`); this was not, so a
        // conversation id was the only thing needed to inject "X is typing…"
        // — under your own username — into a thread you have no part in. The
        // subscription set is already the answer to "may this socket take part
        // here", so consult it rather than re-querying.
        if (!ws.data.subscriptions.has(msg.data.conversation_id)) break;
        broadcastToConversation(
          msg.data.conversation_id,
          {
            type: 'typing.update',
            data: {
              conversation_id: msg.data.conversation_id,
              user_id: ws.data.user.sub,
              username: ws.data.user.username,
              is_typing: msg.type === 'typing.start',
            },
          },
          ws.data.user.sub,
        );
        break;

      case 'read.ack':
        runDetached(handleReadAck(ws.data.user.sub, msg.data.conversation_id), () => {});
        break;
    }
  },

  close(ws: ServerWebSocket<WsData>) {
    const userId = ws.data.user.sub;
    clearTimeout(ws.data.expiryTimer);
    forget(ws);
    const set = connectionsByUser.get(userId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        connectionsByUser.delete(userId);
        runDetached(broadcastPresence(userId, ws.data.user.username, false), (e) =>
          console.error('presence broadcast failed:', e),
        );
      }
    }
  },
};

// Grant a live feed for a conversation only to someone entitled to read it.
// `subscriptions` is the sole gate `broadcastToConversation` consults, so an
// unchecked subscribe would hand any authenticated user the full message stream
// of any conversation whose id they learn. Mirrors the REST read gates: a
// participant row, or the creator (which also covers threads created before the
// owner participant row was seeded).
async function authorizeSubscription(
  ws: ServerWebSocket<WsData>,
  conversationId: string,
): Promise<void> {
  const userId = ws.data.user.sub;
  const entitled =
    (await isConversationParticipant(userId, conversationId)) ||
    (await ownsConversation(userId, conversationId));
  if (!entitled) {
    sendError(ws, 'Not a participant of that conversation');
    return;
  }

  subscribe(ws, conversationId);
}

async function handleReadAck(userId: string, conversationId: string): Promise<void> {
  const db = getDb();
  await db
    .update(conversationParticipants)
    .set({ last_read_at: new Date() })
    .where(
      and(
        eq(conversationParticipants.user_id, userId),
        eq(conversationParticipants.conversation_id, conversationId),
      ),
    );
}

// Local users who should see this user's presence: those who added THIS user
// as a contact (peer_id resolves to this user's agent), not the contacts this
// user has added. Contacts are an asymmetric consent gate, so presence fans out
// to followers.
export async function getPresenceAudience(userId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ userId: peerContacts.user_id })
    .from(peerContacts)
    .innerJoin(peerAgents, eq(peerContacts.peer_id, peerAgents.id))
    .innerJoin(users, eq(peerAgents.did, users.did))
    .where(eq(users.id, userId));

  return rows.map((row) => row.userId);
}

async function broadcastPresence(userId: string, username: string, online: boolean): Promise<void> {
  const audience = await getPresenceAudience(userId);
  if (audience.length === 0) return;

  const message: WsServerMessage = {
    type: 'presence.update',
    data: { user_id: userId, username, online },
  };

  for (const recipientId of audience) {
    sendToUser(recipientId, message);
  }
}
