import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// ws.ts reads the access token via getToken(); mock the api module so we control
// it. `mock.module` is global for the whole run, so re-export the real module's
// other members (api / ApiError / setters) and override only getToken — otherwise
// this stub would leak into and break api.test.ts (the documented cross-file
// mock-leakage gotcha).
const realApi = await import('./api.js');
let currentToken: string | null = 'tok-1';
const getToken = mock(() => currentToken);
mock.module('./api.js', () => ({
  ...realApi,
  getToken,
}));

// Minimal fake WebSocket capturing handlers + sent frames.
class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
  }
}

const realWebSocket = globalThis.WebSocket;
const realLocation = globalThis.location;
const realSetTimeout = globalThis.setTimeout;

let timers: Array<() => void>;

beforeEach(() => {
  currentToken = 'tok-1';
  getToken.mockClear();
  FakeWebSocket.instances = [];
  timers = [];
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  // Deterministic location for URL assembly. `origin` is the field the URL is
  // built from now that a desktop bundle can point elsewhere; the other two are
  // kept because a partial Location is the kind of fake that passes here and
  // fails somewhere else.
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { protocol: 'http:', host: 'example.test', origin: 'http://example.test' } as Location,
  });
  // Capture scheduled reconnects instead of waiting on the clock.
  globalThis.setTimeout = ((fn: () => void) => {
    timers.push(fn);
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
});

afterEach(() => {
  globalThis.WebSocket = realWebSocket;
  Object.defineProperty(globalThis, 'location', { configurable: true, value: realLocation });
  globalThis.setTimeout = realSetTimeout;
});

// Re-import a fresh ws module per test so its module-level socket/handler state
// doesn't leak across cases. Typed via the canonical path so handler params keep
// their types under noImplicitAny.
const importWs = () => import(`./ws.js?t=${Math.random()}`) as Promise<typeof import('./ws.js')>;

describe('ws layer', () => {
  test('connectWs opens a socket with the token in the query and wires handlers', async () => {
    const { connectWs } = await importWs();
    connectWs();

    expect(FakeWebSocket.instances).toHaveLength(1);
    const sock = FakeWebSocket.instances[0];
    expect(sock.url).toBe('ws://example.test/ws?token=tok-1');
    expect(typeof sock.onopen).toBe('function');
    expect(typeof sock.onmessage).toBe('function');
    expect(typeof sock.onclose).toBe('function');
  });

  test('connectWs is a no-op without a token', async () => {
    currentToken = null;
    const { connectWs } = await importWs();
    connectWs();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  test('onWsMessage handlers receive dispatched payloads by type', async () => {
    const { connectWs, onWsMessage } = await importWs();
    connectWs();
    const sock = FakeWebSocket.instances[0];

    const received: unknown[] = [];
    const unsub = onWsMessage('chat.message', (data) => received.push(data));

    sock.onmessage?.({ data: JSON.stringify({ type: 'chat.message', data: { id: 'm1' } }) });
    sock.onmessage?.({ data: JSON.stringify({ type: 'other', data: { id: 'x' } }) });

    expect(received).toEqual([{ id: 'm1' }]);

    // Unsubscribe stops further delivery.
    unsub();
    sock.onmessage?.({ data: JSON.stringify({ type: 'chat.message', data: { id: 'm2' } }) });
    expect(received).toEqual([{ id: 'm1' }]);
  });

  test('onmessage ignores malformed frames without throwing', async () => {
    const { connectWs, onWsMessage } = await importWs();
    connectWs();
    const sock = FakeWebSocket.instances[0];
    const received: unknown[] = [];
    onWsMessage('chat.message', (d) => received.push(d));

    expect(() => sock.onmessage?.({ data: 'not-json' })).not.toThrow();
    expect(received).toEqual([]);
  });

  test('sendWs serializes {type,data} only when the socket is open', async () => {
    const { connectWs, sendWs } = await importWs();
    connectWs();
    const sock = FakeWebSocket.instances[0];

    // Not open yet -> dropped.
    sendWs('subscribe.conversation', { conversation_id: 'c1' });
    expect(sock.sent).toHaveLength(0);

    sock.readyState = FakeWebSocket.OPEN;
    sendWs('subscribe.conversation', { conversation_id: 'c1' });
    expect(sock.sent).toHaveLength(1);
    expect(JSON.parse(sock.sent[0])).toEqual({
      type: 'subscribe.conversation',
      data: { conversation_id: 'c1' },
    });
  });

  test('onclose schedules a reconnect that opens a fresh socket', async () => {
    const { connectWs } = await importWs();
    connectWs();
    const sock = FakeWebSocket.instances[0];

    sock.onclose?.();
    expect(timers).toHaveLength(1);

    // Run the scheduled reconnect.
    timers[0]();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  test('subscribeConversation before OPEN records and flushes on open', async () => {
    const { connectWs, subscribeConversation } = await importWs();
    connectWs();
    const sock = FakeWebSocket.instances[0];

    // Socket still CONNECTING -> the frame is dropped but the desire is recorded.
    subscribeConversation('c1');
    expect(sock.sent).toHaveLength(0);

    // Opening replays every desired subscription onto the now-open socket.
    sock.readyState = FakeWebSocket.OPEN;
    sock.onopen?.();
    expect(sock.sent).toHaveLength(1);
    expect(JSON.parse(sock.sent[0])).toEqual({
      type: 'subscribe.conversation',
      data: { conversation_id: 'c1' },
    });
  });

  test('onopen replays desired subscriptions after an auto-reconnect', async () => {
    const { connectWs, subscribeConversation } = await importWs();
    connectWs();
    const sock1 = FakeWebSocket.instances[0];
    sock1.readyState = FakeWebSocket.OPEN;
    sock1.onopen?.();

    subscribeConversation('c1');
    expect(sock1.sent.map((s) => JSON.parse(s))).toContainEqual({
      type: 'subscribe.conversation',
      data: { conversation_id: 'c1' },
    });

    // Drop the socket and run the scheduled reconnect.
    sock1.onclose?.();
    timers[0]();
    const sock2 = FakeWebSocket.instances[1];

    // The server's per-socket set is fresh; opening replays the desired sub.
    sock2.readyState = FakeWebSocket.OPEN;
    sock2.onopen?.();
    expect(sock2.sent.map((s) => JSON.parse(s))).toContainEqual({
      type: 'subscribe.conversation',
      data: { conversation_id: 'c1' },
    });
  });

  test('unsubscribeConversation removes from the desired set and sends the frame', async () => {
    const { connectWs, subscribeConversation, unsubscribeConversation } = await importWs();
    connectWs();
    const sock = FakeWebSocket.instances[0];
    sock.readyState = FakeWebSocket.OPEN;
    sock.onopen?.();

    subscribeConversation('c1');
    unsubscribeConversation('c1');
    expect(sock.sent.map((s) => JSON.parse(s))).toContainEqual({
      type: 'unsubscribe.conversation',
      data: { conversation_id: 'c1' },
    });

    // Removed from the desired set: a reconnect must not replay it.
    sock.onclose?.();
    timers[0]();
    const sock2 = FakeWebSocket.instances[1];
    sock2.readyState = FakeWebSocket.OPEN;
    sock2.onopen?.();
    expect(sock2.sent).toHaveLength(0);
  });

  test('reconnectWs keeps desired subscriptions for the same user', async () => {
    const { connectWs, subscribeConversation, reconnectWs } = await importWs();
    connectWs();
    const sock1 = FakeWebSocket.instances[0];
    sock1.readyState = FakeWebSocket.OPEN;
    sock1.onopen?.();
    subscribeConversation('c1');

    // Token refresh: drop and immediately reopen with the same desired set.
    reconnectWs();
    const sock2 = FakeWebSocket.instances[1];
    sock2.readyState = FakeWebSocket.OPEN;
    sock2.onopen?.();
    expect(sock2.sent.map((s) => JSON.parse(s))).toContainEqual({
      type: 'subscribe.conversation',
      data: { conversation_id: 'c1' },
    });
  });

  test('disconnectWs clears desired subscriptions so a later session replays nothing', async () => {
    const { connectWs, subscribeConversation, disconnectWs } = await importWs();
    connectWs();
    const sock1 = FakeWebSocket.instances[0];
    sock1.readyState = FakeWebSocket.OPEN;
    sock1.onopen?.();
    subscribeConversation('c1');

    // Logout tears the socket down and forgets what was subscribed.
    disconnectWs();

    // A fresh connection (e.g. a different user logging in) replays nothing.
    connectWs();
    const sock2 = FakeWebSocket.instances[1];
    sock2.readyState = FakeWebSocket.OPEN;
    sock2.onopen?.();
    expect(sock2.sent).toHaveLength(0);
  });
});
