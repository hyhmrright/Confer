import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { exportPrivateKey, generateEd25519KeyPair } from '@confer/identity';
import { sendA2AMessage } from './outbound.js';

// Real Ed25519 signing is used (no identity mock) so this file never leaks a
// stubbed @confer/identity into sibling tests under bun's process-global
// mock.module. Only fetch is stubbed.
let signingJwk: string;

beforeAll(async () => {
  const kp = await generateEd25519KeyPair();
  signingJwk = JSON.stringify(await exportPrivateKey(kp.privateKey));
});

function stubFetch(impl: (req: Request) => Response | Promise<Response>): void {
  const real = globalThis.fetch;
  restore = () => {
    globalThis.fetch = real;
  };
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    return Promise.resolve(impl(req));
  }) as typeof fetch;
}

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

const MSG = {
  from: 'did:web:me',
  to: 'did:web:peer',
  thread_id: 't-1',
  message: { type: 'question' as const, content: 'hello' },
};

describe('sendA2AMessage', () => {
  test('POSTs the signed message to <endpoint>/messages and returns the parsed body', async () => {
    let seen: { url: string; method: string; body: unknown; signature: string | null } | undefined;
    stubFetch(async (req) => {
      seen = {
        url: req.url,
        method: req.method,
        body: await req.json(),
        signature: req.headers.get('signature'),
      };
      return Response.json({ message_id: 'm1', thread_id: 't-1', stream_url: '/a2a/v1/stream/m1' });
    });

    const res = await sendA2AMessage('https://peer.test/a2a/v1', MSG, 'did:web:me#k1', signingJwk);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.message_id).toBe('m1');
    expect(seen?.url).toBe('https://peer.test/a2a/v1/messages');
    expect(seen?.method).toBe('POST');
    expect(seen?.body).toEqual(MSG);
    // signRequest attached an HTTP-message signature header.
    expect(seen?.signature).toBeTruthy();
  });

  test('err with status + body text on a non-ok remote response', async () => {
    stubFetch(() => new Response('denied', { status: 403 }));
    const res = await sendA2AMessage('https://peer.test/a2a/v1', MSG, 'did:web:me#k1', signingJwk);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('403');
      expect(res.error).toContain('denied');
    }
  });

  test('err when the transport throws', async () => {
    stubFetch(() => {
      throw new Error('connection refused');
    });
    const res = await sendA2AMessage('https://peer.test/a2a/v1', MSG, 'did:web:me#k1', signingJwk);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('connection refused');
  });

  test('err when the private key JWK is malformed', async () => {
    const res = await sendA2AMessage('https://peer.test/a2a/v1', MSG, 'k', 'not-json');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('sendA2AMessage failed');
  });
});
