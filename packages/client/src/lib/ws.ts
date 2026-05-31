import { getToken } from './api.js';

type MessageHandler = (data: unknown) => void;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const handlers = new Map<string, Set<MessageHandler>>();

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
    socket.close();
    socket = null;
  }
}

export function sendWs(type: string, data?: Record<string, unknown>): void {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type, data }));
}

export function subscribeConversation(conversationId: string): void {
  sendWs('subscribe.conversation', { conversation_id: conversationId });
}

export function unsubscribeConversation(conversationId: string): void {
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
