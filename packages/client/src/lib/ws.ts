import { getToken } from './api.js';

type MessageHandler = (data: unknown) => void;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const handlers = new Map<string, Set<MessageHandler>>();

// The conversations the client *wants* subscribed, independent of the current
// socket's state. This is the source of truth replayed on every (re)connect so
// the server's fresh per-socket subscription set is repopulated after a drop,
// token refresh, or a subscribe issued before the socket finished opening.
const desiredSubscriptions = new Set<string>();

export function connectWs(): void {
  const token = getToken();
  if (!token || socket?.readyState === WebSocket.OPEN) return;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}/ws?token=${token}`);

  socket.onopen = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    // Replay every desired subscription onto the fresh socket: the server's
    // per-socket set is empty on each connect, and any subscribe issued before
    // this socket opened was dropped by sendWs. Covers reconnect + boot race.
    for (const conversationId of desiredSubscriptions) {
      sendWs('subscribe.conversation', { conversation_id: conversationId });
    }
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as { type: string; data: unknown };
      const typeHandlers = handlers.get(msg.type);
      if (typeHandlers) {
        for (const handler of typeHandlers) {
          handler(msg.data);
        }
      }
    } catch {
      // ignore malformed messages
    }
  };

  socket.onclose = () => {
    socket = null;
    reconnectTimer = setTimeout(connectWs, 3000);
  };
}

export function disconnectWs(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    // Detach onclose first. close() is asynchronous, so leaving the handler
    // attached lets it fire *after* this function returns and schedule the
    // 3s retry we just cancelled — which reopens a socket with a live token
    // and no registered handlers. reconnectWs has always done this; this one
    // did not, so leaving ChatLayout for /settings left a zombie behind.
    socket.onclose = null;
    socket.close();
    socket = null;
  }
  // Logout/unmount: forget intended subscriptions so a later login as a
  // different user never replays a stale one. reconnectWs keeps them (same user,
  // new token) so onopen can re-establish the active conversation.
  desiredSubscriptions.clear();
}

// Drop the current socket (without scheduling the usual delayed retry) and open
// a fresh one with the latest token. Used after a token refresh so a connection
// that was opened with an expired token doesn't sit broken until it times out.
export function reconnectWs(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
  connectWs();
}

export function sendWs(type: string, data?: Record<string, unknown>): void {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type, data }));
}

export function subscribeConversation(conversationId: string): void {
  desiredSubscriptions.add(conversationId);
  // Sends now if the socket is open; otherwise the id waits in
  // desiredSubscriptions and onopen replays it.
  sendWs('subscribe.conversation', { conversation_id: conversationId });
}

export function unsubscribeConversation(conversationId: string): void {
  desiredSubscriptions.delete(conversationId);
  sendWs('unsubscribe.conversation', { conversation_id: conversationId });
}

export function onWsMessage(type: string, handler: MessageHandler): () => void {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  set.add(handler);
  return () => set?.delete(handler);
}
