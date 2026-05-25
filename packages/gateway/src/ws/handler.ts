import type { Server, ServerWebSocket } from 'bun';
import * as jose from 'jose';
import { wsClientMessageSchema, type WsServerMessage } from '@confer/shared';
import { getDb } from '../db/connection.js';
import { conversationParticipants, peerContacts, peerAgents, users } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { getEnv } from '../env.js';
import type { AuthPayload } from '../middleware/auth.js';

export interface WsData {
  user: AuthPayload;
  subscriptions: Set<string>;
}

const connectionsByUser = new Map<string, Set<ServerWebSocket<WsData>>>();

export function getWsConnections(userId: string): Set<ServerWebSocket<WsData>> {
  return connectionsByUser.get(userId) ?? new Set();
}

export function broadcastToConversation(
  conversationId: string,
  message: WsServerMessage,
  exclude?: string,
): void {
  const payload = JSON.stringify(message);
  for (const [userId, connections] of connectionsByUser) {
    if (userId === exclude) continue;
    for (const ws of connections) {
      if (ws.data.subscriptions.has(conversationId)) {
        ws.send(payload);
      }
    }
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

async function authenticateUpgrade(req: Request): Promise<AuthPayload | null> {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) return null;

  const env = getEnv();
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  try {
    const { payload } = await jose.jwtVerify(token, secret, { issuer: env.JWT_ISSUER });
    return { sub: payload.sub as string, username: payload.username as string };
  } catch {
    return null;
  }
}

export const websocket = {
  async upgrade(req: Request, server: Server<unknown>): Promise<Response | undefined> {
    const user = await authenticateUpgrade(req);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const success = server.upgrade(req, {
      data: { user, subscriptions: new Set<string>() } satisfies WsData,
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

    broadcastPresence(userId, ws.data.user.username, true).catch((e) => console.error('presence broadcast failed:', e));
  },

  message(ws: ServerWebSocket<WsData>, raw: string | Buffer) {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      ws.send(JSON.stringify({ type: 'error', data: { message: 'Invalid JSON' } }));
      return;
    }

    const result = wsClientMessageSchema.safeParse(parsed);
    if (!result.success) {
      ws.send(JSON.stringify({ type: 'error', data: { message: 'Invalid message format' } }));
      return;
    }

    const msg = result.data;
    switch (msg.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', data: {} }));
        break;

      case 'subscribe.conversation':
        ws.data.subscriptions.add(msg.data.conversation_id);
        break;

      case 'unsubscribe.conversation':
        ws.data.subscriptions.delete(msg.data.conversation_id);
        break;

      case 'typing.start':
      case 'typing.stop':
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
        handleReadAck(ws.data.user.sub, msg.data.conversation_id).catch(() => {});
        break;
    }
  },

  close(ws: ServerWebSocket<WsData>) {
    const userId = ws.data.user.sub;
    const set = connectionsByUser.get(userId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        connectionsByUser.delete(userId);
        broadcastPresence(userId, ws.data.user.username, false).catch((e) => console.error('presence broadcast failed:', e));
      }
    }
  },
};

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

async function broadcastPresence(userId: string, username: string, online: boolean): Promise<void> {
  const db = getDb();

  const rows = await db
    .select({ userId: users.id })
    .from(peerContacts)
    .innerJoin(peerAgents, eq(peerContacts.peer_id, peerAgents.id))
    .innerJoin(users, eq(peerAgents.did, users.did))
    .where(eq(peerContacts.user_id, userId));

  if (rows.length === 0) return;

  const message: WsServerMessage = {
    type: 'presence.update',
    data: { user_id: userId, username, online },
  };

  for (const row of rows) {
    sendToUser(row.userId, message);
  }
}
