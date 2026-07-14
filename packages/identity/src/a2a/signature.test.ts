import { describe, expect, test } from 'bun:test';
import { generateEd25519KeyPair } from '../crypto/keypair.js';
import {
  buildSignatureString,
  computeDigest,
  parseSignatureHeader,
  signRequest,
  verifyRequestSignature,
} from './signature.js';

const ENDPOINT = 'https://agent.example.com/a2a/v1';

function jsonRequest(body: unknown): Request {
  return new Request(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('parseSignatureHeader', () => {
  test('parses a complete signature header', () => {
    const result = parseSignatureHeader(
      'keyId="did:web:a.com#key-1",algorithm="ed25519",headers="(request-target) host date",signature="abc123"',
    );
    expect(result).toEqual({
      ok: true,
      value: {
        keyId: 'did:web:a.com#key-1',
        algorithm: 'ed25519',
        headers: ['(request-target)', 'host', 'date'],
        signature: 'abc123',
      },
    });
  });

  test('rejects a header missing the signature field', () => {
    const result = parseSignatureHeader('keyId="k",headers="host"');
    expect(result).toEqual({ ok: false, error: 'Incomplete signature header' });
  });

  test('rejects a header missing the keyId field', () => {
    const result = parseSignatureHeader('headers="host",signature="abc"');
    expect(result).toEqual({ ok: false, error: 'Incomplete signature header' });
  });

  test('extracts the unquoted (created) integer parameter', () => {
    const result = parseSignatureHeader(
      'keyId="k",algorithm="ed25519",created=1618884475,headers="(created) host",signature="abc"',
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.created).toBe(1618884475);
  });

  test('leaves created undefined when absent', () => {
    const result = parseSignatureHeader('keyId="k",headers="host",signature="abc"');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.created).toBeUndefined();
  });
});

describe('computeDigest', () => {
  test('is deterministic and SHA-256 prefixed', async () => {
    const a = await computeDigest('{"hello":"world"}');
    const b = await computeDigest('{"hello":"world"}');
    expect(a).toBe(b);
    expect(a.startsWith('SHA-256=')).toBe(true);
  });

  test('differs for different bodies', async () => {
    expect(await computeDigest('a')).not.toBe(await computeDigest('b'));
  });
});

describe('buildSignatureString', () => {
  test('renders (request-target) and header values line by line', async () => {
    const req = new Request(ENDPOINT, { method: 'POST', headers: { host: 'agent.example.com' } });
    const str = await buildSignatureString(req, ['(request-target)', 'host']);
    expect(str).toBe('(request-target): post /a2a/v1\nhost: agent.example.com');
  });
});

describe('signRequest / verifyRequestSignature', () => {
  test('a freshly signed request verifies against its public key', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const signed = await signRequest(
      jsonRequest({ task: 'ping' }),
      privateKey,
      'did:web:a.com#key-1',
    );

    expect(signed.headers.get('signature')).toBeTruthy();
    const result = await verifyRequestSignature(signed, publicKey);
    expect(result).toEqual({ ok: true, value: true });
  });

  test('a signed body-less GET verifies (digest omitted from the signing set)', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const signed = await signRequest(new Request(ENDPOINT, { method: 'GET' }), privateKey, 'k');

    // No body means no Digest header, and `digest` must not be referenced in
    // the signing set — otherwise the verifier rejects the missing header.
    expect(signed.headers.get('digest')).toBeNull();
    expect(signed.headers.get('signature')).not.toContain('digest');
    expect(await verifyRequestSignature(signed, publicKey)).toEqual({ ok: true, value: true });
  });

  test('fails verification with the wrong public key', async () => {
    const signer = await generateEd25519KeyPair();
    const attacker = await generateEd25519KeyPair();
    const signed = await signRequest(jsonRequest({ task: 'ping' }), signer.privateKey, 'k');

    const result = await verifyRequestSignature(signed, attacker.publicKey);
    expect(result).toEqual({ ok: false, error: 'Signature verification failed' });
  });

  test('detects a tampered body via digest mismatch', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const signed = await signRequest(jsonRequest({ amount: 1 }), privateKey, 'k');

    // Replay the signed headers over a different body.
    const tampered = new Request(ENDPOINT, {
      method: 'POST',
      headers: signed.headers,
      body: JSON.stringify({ amount: 1000000 }),
    });
    const result = await verifyRequestSignature(tampered, publicKey);
    expect(result).toEqual({ ok: false, error: 'Digest mismatch' });
  });

  test('rejects a request with no Signature header', async () => {
    const { publicKey } = await generateEd25519KeyPair();
    const result = await verifyRequestSignature(jsonRequest({}), publicKey);
    expect(result).toEqual({ ok: false, error: 'Missing Signature header' });
  });

  test('rejects a request whose Date is outside the clock-skew window', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const body = { task: 'ping' };
    const signed = await signRequest(jsonRequest(body), privateKey, 'k');

    const headers = new Headers(signed.headers);
    headers.set('date', new Date(Date.now() - 10 * 60 * 1000).toUTCString());
    const replayed = new Request(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) });

    const result = await verifyRequestSignature(replayed, publicKey);
    expect(result).toEqual({ ok: false, error: 'Request date outside acceptable window' });
  });

  test('rejects a malformed Date header', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const body = { task: 'ping' };
    const signed = await signRequest(jsonRequest(body), privateKey, 'k');

    const headers = new Headers(signed.headers);
    headers.set('date', 'not-a-date');
    const bad = new Request(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) });

    const result = await verifyRequestSignature(bad, publicKey);
    expect(result).toEqual({ ok: false, error: 'Invalid Date header format' });
  });
});

describe('verifyRequestSignature minimum covered set (Finding B)', () => {
  // Hand-sign an arbitrary covered set so we can construct signatures that a
  // well-behaved signer would never produce (e.g. omitting host, or a body
  // without digest). The signature is cryptographically valid over `headers`;
  // the point is that verification must reject it on the covered set alone.
  async function signWithHeaders(
    privateKey: CryptoKey,
    headers: string[],
    opts: { body?: string } = {},
  ): Promise<Request> {
    const reqHeaders: Record<string, string> = {
      host: 'agent.example.com',
      date: new Date().toUTCString(),
    };
    const toSign = new Request(ENDPOINT, { method: 'POST', headers: reqHeaders, body: opts.body });
    const sigString = await buildSignatureString(toSign, headers);
    const sig = await crypto.subtle.sign(
      'Ed25519',
      privateKey,
      new TextEncoder().encode(sigString),
    );
    const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
    reqHeaders.signature = `keyId="k",algorithm="ed25519",headers="${headers.join(' ')}",signature="${sigBase64}"`;
    return new Request(ENDPOINT, { method: 'POST', headers: reqHeaders, body: opts.body });
  }

  test('rejects a covered set missing (request-target)', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const req = await signWithHeaders(privateKey, ['host', 'date']);
    expect(await verifyRequestSignature(req, publicKey)).toEqual({
      ok: false,
      error: 'Signature must cover (request-target)',
    });
  });

  test('rejects a covered set missing host', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const req = await signWithHeaders(privateKey, ['(request-target)', 'date']);
    expect(await verifyRequestSignature(req, publicKey)).toEqual({
      ok: false,
      error: 'Signature must cover host',
    });
  });

  test('rejects a covered set missing date', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const req = await signWithHeaders(privateKey, ['(request-target)', 'host']);
    expect(await verifyRequestSignature(req, publicKey)).toEqual({
      ok: false,
      error: 'Signature must cover date',
    });
  });

  test('rejects a body-bearing request whose covered set lacks digest (audit PoC)', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    // Covers the minimum set but NOT digest, over a request that carries a body.
    // Pre-fix this verified — the body was left unbound, so an attacker could
    // swap it after signing — so it must now be rejected before the Ed25519
    // check ever runs.
    const req = await signWithHeaders(privateKey, ['(request-target)', 'host', 'date'], {
      body: JSON.stringify({ amount: 1 }),
    });
    expect(await verifyRequestSignature(req, publicKey)).toEqual({
      ok: false,
      error: 'Signature must cover digest for a request with a body',
    });
  });
});

describe('verifyRequestSignature with a (created) pseudo-header', () => {
  // Our own `signRequest` doesn't sign `(created)`, so build the signed request
  // by hand: sign the string that includes the signer's own timestamp and pack
  // that same `created` into the Signature header as an unquoted integer.
  async function signWithCreated(
    privateKey: CryptoKey,
    created: number,
  ): Promise<{ request: Request; date: string }> {
    const date = new Date().toUTCString();
    const body = JSON.stringify({ task: 'ping' });
    // The request carries a body, so Finding B requires `digest` in the covered
    // set. Include it here — these cases exercise the `(created)` skew logic, not
    // the covered-set gate.
    const digest = await computeDigest(body);
    const signHeaders = ['(request-target)', '(created)', 'host', 'date', 'digest'];
    const toSign = new Request(ENDPOINT, {
      method: 'POST',
      headers: { host: 'agent.example.com', date, digest },
      body,
    });
    const sigString = await buildSignatureString(toSign, signHeaders, created);
    const sig = await crypto.subtle.sign(
      'Ed25519',
      privateKey,
      new TextEncoder().encode(sigString),
    );
    const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
    const request = new Request(ENDPOINT, {
      method: 'POST',
      headers: {
        host: 'agent.example.com',
        date,
        digest,
        signature: `keyId="k",algorithm="ed25519",created=${created},headers="${signHeaders.join(' ')}",signature="${sigBase64}"`,
      },
      body,
    });
    return { request, date };
  }

  test('verifies against the signer-supplied created timestamp', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const created = Math.floor(Date.now() / 1000);
    const { request } = await signWithCreated(privateKey, created);

    expect(await verifyRequestSignature(request, publicKey)).toEqual({ ok: true, value: true });
  });

  test('rejects a created timestamp outside the clock-skew window', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    // 10 minutes in the past — the Date header stays fresh, so only the
    // (created) window check can reject this request.
    const created = Math.floor(Date.now() / 1000) - 10 * 60;
    const { request } = await signWithCreated(privateKey, created);

    expect(await verifyRequestSignature(request, publicKey)).toEqual({
      ok: false,
      error: 'Signature (created) outside acceptable window',
    });
  });
});
