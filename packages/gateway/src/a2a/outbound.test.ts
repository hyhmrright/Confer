import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { exportPrivateKey, generateEd25519KeyPair } from '@confer/identity';
import { selfA2AEndpoint } from '../lib/public-identity.js';
import { sendA2AMessage } from './outbound.js';

// Real Ed25519 signing is used (no identity mock) so this file never leaks a
// stubbed @confer/identity into sibling tests under bun's process-global
// mock.module. Only fetch is stubbed.
let signingJwk: string;

beforeAll(async () => {
  const kp = await generateEd25519KeyPair();
  signingJwk = JSON.stringify(await exportPrivateKey(kp.privateKey));
});

function stubFetch(impl: (req: Request, init?: RequestInit) => Response | Promise<Response>): void {
  const real = globalThis.fetch;
  restore = () => {
    globalThis.fetch = real;
  };
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    return Promise.resolve(impl(req, init));
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
    let seen:
      | {
          url: string;
          method: string;
          body: unknown;
          signatureInput: string | null;
          signature: string | null;
          contentDigest: string | null;
        }
      | undefined;
    stubFetch(async (req) => {
      seen = {
        url: req.url,
        method: req.method,
        body: await req.json(),
        signatureInput: req.headers.get('signature-input'),
        signature: req.headers.get('signature'),
        contentDigest: req.headers.get('content-digest'),
      };
      return Response.json({ message_id: 'm1', thread_id: 't-1', stream_url: '/a2a/v1/stream/m1' });
    });

    const res = await sendA2AMessage('https://peer.test/a2a/v1', MSG, 'did:web:me#k1', signingJwk);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.message_id).toBe('m1');
    expect(seen?.url).toBe('https://peer.test/a2a/v1/messages');
    expect(seen?.method).toBe('POST');
    expect(seen?.body).toEqual(MSG);
    // signRequest attached RFC 9421 structured-field headers + an RFC 9530 digest.
    expect(seen?.signatureInput).toContain('sig1=(');
    expect(seen?.signature).toMatch(/^sig1=:.+:$/);
    expect(seen?.contentDigest).toMatch(/^sha-256=:.+:$/);
  });

  // The error surfaces in the consult route's 502. The far side's code is
  // useful there; its body is whatever it chose to send, and stays out.
  test('err names the status and the peer error code, never the body', async () => {
    stubFetch(() =>
      Response.json(
        { error: { code: 'not_a_contact', message: 'internal detail' } },
        { status: 403 },
      ),
    );
    const res = await sendA2AMessage('https://peer.test/a2a/v1', MSG, 'did:web:me#k1', signingJwk);
    expect(res).toEqual({ ok: false, error: 'Remote returned 403 (not_a_contact)' });
  });

  test('err carries no code when the body is not our error shape', async () => {
    stubFetch(() => new Response('denied', { status: 500 }));
    const res = await sendA2AMessage('https://peer.test/a2a/v1', MSG, 'did:web:me#k1', signingJwk);
    expect(res).toEqual({ ok: false, error: 'Remote returned 500' });
  });

  // The endpoint comes from a DID document its owner wrote. Each of these used
  // to be POSTed to, signed, from inside the gateway's network.
  test('refuses an endpoint that is not plain https to a public host, without dialling', async () => {
    let dialled = false;
    stubFetch(() => {
      dialled = true;
      return Response.json({});
    });
    for (const endpoint of [
      'http://peer.test/a2a/v1',
      'https://10.0.0.5/a2a/v1',
      'https://169.254.169.254/latest',
      'https://[::1]:6333/collections',
      'https://localhost/a2a/v1',
      // A trailing `?` or `#` swallows the appended `/messages`.
      'https://peer.test/collections/x/points/delete?',
      'https://peer.test/a2a/v1#',
      'not a url',
    ]) {
      const res = await sendA2AMessage(endpoint, MSG, 'did:web:me#k1', signingJwk);
      expect(res.ok).toBe(false);
    }
    expect(dialled).toBe(false);
  });

  test('does not follow a redirect', async () => {
    let redirect: RequestRedirect | undefined;
    stubFetch((_req, init) => {
      redirect = init?.redirect;
      return new Response(null, { status: 307, headers: { location: 'http://qdrant:6333/' } });
    });
    const res = await sendA2AMessage('https://peer.test/a2a/v1', MSG, 'did:web:me#k1', signingJwk);
    expect(redirect).toBe('manual');
    expect(res).toEqual({ ok: false, error: 'Remote returned 307' });
  });

  test('rewrites only our exact endpoint to loopback', async () => {
    let dialledUrl = '';
    stubFetch((req) => {
      dialledUrl = req.url;
      return Response.json({ message_id: 'm1', thread_id: 't-1', stream_url: '/s' });
    });
    const res = await sendA2AMessage(selfA2AEndpoint(), MSG, 'did:web:me#k1', signingJwk);
    expect(res.ok).toBe(true);
    expect(dialledUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/a2a\/v1\/messages$/);
  });

  // A string that merely starts like ours parses to somewhere else entirely:
  // `<ours>/../../api/…` was rewritten to loopback and skipped every check.
  test('vets an endpoint that only begins like ours, rather than rewriting it', async () => {
    let dialled = false;
    stubFetch(() => {
      dialled = true;
      return Response.json({});
    });
    for (const endpoint of [
      `${selfA2AEndpoint()}/../../api/v1/admin/x`,
      `${selfA2AEndpoint()}/x?`,
      `${selfA2AEndpoint()}/x#`,
    ]) {
      const res = await sendA2AMessage(endpoint, MSG, 'did:web:me#k1', signingJwk);
      expect(res.ok).toBe(false);
    }
    expect(dialled).toBe(false);
  });

  // The parser's own error quotes the body it choked on.
  test('reports a 2xx that is not JSON without repeating it', async () => {
    stubFetch(() => new Response('secretvalue', { status: 200 }));
    const res = await sendA2AMessage('https://peer.test/a2a/v1', MSG, 'did:web:me#k1', signingJwk);
    expect(res).toEqual({ ok: false, error: 'Remote returned a response that is not JSON' });
  });

  // What the connection failed with describes whatever answers at the peer's
  // address, so it is logged and never handed back.
  test('err when the transport throws, without its message', async () => {
    stubFetch(() => {
      throw new Error('connection refused');
    });
    const res = await sendA2AMessage('https://peer.test/a2a/v1', MSG, 'did:web:me#k1', signingJwk);
    expect(res).toEqual({ ok: false, error: 'sendA2AMessage failed' });
  });

  test('err when the private key JWK is malformed', async () => {
    const res = await sendA2AMessage('https://peer.test/a2a/v1', MSG, 'k', 'not-json');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('sendA2AMessage failed');
  });
});
