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
  // Deterministic location for URL assembly.
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { protocol: 'http:', host: 'example.test' } as Location,
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
});
