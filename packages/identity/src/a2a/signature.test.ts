import { describe, expect, test } from 'bun:test';
import { generateEd25519KeyPair } from '../crypto/keypair.js';
import {
  buildSignatureBase,
  computeDigest,
  signRequest,
  verifyRequestSignature,
} from './signature.js';
import { serializeSignatureParams, serializeSignatureValue } from './structured-fields.js';

const ENDPOINT = 'https://agent.example.com/a2a/v1/messages';
const KEY_ID = 'did:web:a.com#key-1';

function jsonRequest(body: unknown): Request {
  return new Request(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Hand-craft a signed request over an arbitrary covered set / parameters, so we
// can build signatures a well-behaved signer would never emit (e.g. omitting
// @method, a stale created, a wrong alg). The signature is cryptographically
// valid over `components`; verification must still reject it on the covered-set
// / freshness / alg rules alone. Content-Digest is set only when the covered set
// includes it, mirroring the real signer.
async function craftSignedRequest(
  privateKey: CryptoKey,
  components: string[],
  opts: {
    keyid?: string;
    created?: number;
    alg?: string;
    body?: string;
    method?: string;
    url?: string;
    date?: string | null;
  } = {},
): Promise<Request> {
  const method = opts.method ?? 'POST';
  const url = opts.url ?? ENDPOINT;
  const keyid = opts.keyid ?? KEY_ID;
  const created = opts.created ?? Math.floor(Date.now() / 1000);
  const alg = opts.alg ?? 'ed25519';
  const body = opts.body;

  const headers = new Headers();
  if (opts.date !== null) headers.set('date', opts.date ?? new Date().toUTCString());
  if (body !== undefined && components.includes('content-digest')) {
    headers.set('content-digest', await computeDigest(body));
  }

  const paramsValue = serializeSignatureParams(components, { keyid, created, alg });
  const base = await buildSignatureBase(
    new Request(url, { method, headers, body }),
    components,
    paramsValue,
  );
  if (!base.ok) throw new Error(`test base build failed: ${base.error}`);
  const sig = await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(base.value));

  headers.set('signature-input', `sig1=${paramsValue}`);
  headers.set('signature', serializeSignatureValue(new Uint8Array(sig)));
  return new Request(url, { method, headers, body });
}

describe('computeDigest (RFC 9530)', () => {
  test('is deterministic and in sha-256=:<b64>: form', async () => {
    const a = await computeDigest('{"hello":"world"}');
    const b = await computeDigest('{"hello":"world"}');
    expect(a).toBe(b);
    expect(a).toMatch(/^sha-256=:[A-Za-z0-9+/=]+:$/);
  });

  test('differs for different bodies', async () => {
    expect(await computeDigest('a')).not.toBe(await computeDigest('b'));
  });
});

describe('buildSignatureBase (RFC 9421 §2.5)', () => {
  test('renders derived components then the @signature-params line', async () => {
    const req = new Request(ENDPOINT, {
      method: 'POST',
      headers: { date: 'Sun, 24 Nov 2024 14:30:00 GMT' },
    });
    const paramsValue = serializeSignatureParams(['@method', '@authority', '@path', 'date'], {
      keyid: KEY_ID,
      created: 1700000000,
      alg: 'ed25519',
    });
    const base = await buildSignatureBase(
      req,
      ['@method', '@authority', '@path', 'date'],
      paramsValue,
    );
    expect(base.ok).toBe(true);
    if (base.ok) {
      expect(base.value).toBe(
        [
          '"@method": POST',
          '"@authority": agent.example.com',
          '"@path": /a2a/v1/messages',
          '"date": Sun, 24 Nov 2024 14:30:00 GMT',
          `"@signature-params": ${paramsValue}`,
        ].join('\n'),
      );
    }
  });

  test('errors when a covered component is absent from the request', async () => {
    const req = new Request(ENDPOINT, { method: 'POST' });
    const base = await buildSignatureBase(req, ['x-missing'], '("x-missing")');
    expect(base.ok).toBe(false);
  });
});

describe('signRequest produces the RFC 9421 wire format', () => {
  test('emits Signature-Input/Signature/Content-Digest and no legacy headers', async () => {
    const { privateKey } = await generateEd25519KeyPair();
    const signed = await signRequest(jsonRequest({ task: 'ping' }), privateKey, KEY_ID);

    const sigInput = signed.headers.get('signature-input');
    expect(sigInput).toContain('sig1=(');
    expect(sigInput).toContain('"@method"');
    expect(sigInput).toContain('"@authority"');
    expect(sigInput).toContain('"@path"');
    expect(sigInput).toContain('"content-digest"');
    expect(sigInput).toContain('"date"');
    expect(sigInput).toContain(`keyid="${KEY_ID}"`);
    expect(sigInput).toContain('alg="ed25519"');
    expect(sigInput).toMatch(/created=\d+/);

    expect(signed.headers.get('signature')).toMatch(/^sig1=:[A-Za-z0-9+/=]+:$/);
    expect(signed.headers.get('content-digest')).toMatch(/^sha-256=:[A-Za-z0-9+/=]+:$/);

    // No draft-cavage / legacy artifacts remain (AC-2).
    expect(signed.headers.get('digest')).toBeNull();
    expect(signed.headers.get('signature')).not.toContain('keyId');
    expect(signed.headers.get('signature')).not.toContain('algorithm');
  });

  test('a body-less GET omits Content-Digest from headers and the covered set', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const signed = await signRequest(new Request(ENDPOINT, { method: 'GET' }), privateKey, KEY_ID);

    expect(signed.headers.get('content-digest')).toBeNull();
    expect(signed.headers.get('signature-input')).not.toContain('content-digest');
    expect(await verifyRequestSignature(signed, publicKey)).toEqual({ ok: true, value: true });
  });
});

describe('signRequest / verifyRequestSignature round-trips', () => {
  test('a freshly signed POST verifies against its public key', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const signed = await signRequest(jsonRequest({ task: 'ping' }), privateKey, KEY_ID);
    expect(await verifyRequestSignature(signed, publicKey)).toEqual({ ok: true, value: true });
  });

  test('fails verification with the wrong public key', async () => {
    const signer = await generateEd25519KeyPair();
    const attacker = await generateEd25519KeyPair();
    const signed = await signRequest(jsonRequest({ task: 'ping' }), signer.privateKey, KEY_ID);

    expect(await verifyRequestSignature(signed, attacker.publicKey)).toEqual({
      ok: false,
      error: 'Signature verification failed',
    });
  });

  test('detects a tampered body via Content-Digest mismatch', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const signed = await signRequest(jsonRequest({ amount: 1 }), privateKey, KEY_ID);

    // Replay the signed headers over a different body.
    const tampered = new Request(ENDPOINT, {
      method: 'POST',
      headers: signed.headers,
      body: JSON.stringify({ amount: 1000000 }),
    });
    expect(await verifyRequestSignature(tampered, publicKey)).toEqual({
      ok: false,
      error: 'Content-Digest mismatch',
    });
  });

  test('rejects a request with no Signature-Input header', async () => {
    const { publicKey } = await generateEd25519KeyPair();
    expect(await verifyRequestSignature(jsonRequest({}), publicKey)).toEqual({
      ok: false,
      error: 'Missing Signature-Input header',
    });
  });

  test('rejects a request that has Signature-Input but no Signature', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const req = await craftSignedRequest(privateKey, ['@method', '@authority', '@path', 'date']);
    const headers = new Headers(req.headers);
    headers.delete('signature');
    const stripped = new Request(ENDPOINT, { method: 'POST', headers });
    expect(await verifyRequestSignature(stripped, publicKey)).toEqual({
      ok: false,
      error: 'Missing Signature header',
    });
  });

  test('accepts @target-uri as the alternative request-target form', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const req = await craftSignedRequest(privateKey, ['@method', '@target-uri', 'date']);
    expect(await verifyRequestSignature(req, publicKey)).toEqual({ ok: true, value: true });
  });
});

describe('verifyRequestSignature minimum covered set (Finding B)', () => {
  test('rejects a covered set missing @method', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const req = await craftSignedRequest(privateKey, ['@authority', '@path', 'date']);
    expect(await verifyRequestSignature(req, publicKey)).toEqual({
      ok: false,
      error: 'Signature must cover @method',
    });
  });

  test('rejects a covered set missing the request target', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    // Has @path but not @authority (and no @target-uri) → target not covered.
    const req = await craftSignedRequest(privateKey, ['@method', '@path', 'date']);
    expect(await verifyRequestSignature(req, publicKey)).toEqual({
      ok: false,
      error: 'Signature must cover @target-uri or both @path and @authority',
    });
  });

  test('rejects a covered set missing date', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const req = await craftSignedRequest(privateKey, ['@method', '@authority', '@path']);
    expect(await verifyRequestSignature(req, publicKey)).toEqual({
      ok: false,
      error: 'Signature must cover date',
    });
  });

  test('rejects a body-bearing request whose covered set lacks content-digest (audit PoC)', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    // Covers the minimum set but NOT content-digest, over a request with a body.
    // Pre-hardening this verified — the body was left unbound, so an attacker
    // could swap it after signing — so it must now be rejected before Ed25519.
    const req = await craftSignedRequest(privateKey, ['@method', '@authority', '@path', 'date'], {
      body: JSON.stringify({ amount: 1 }),
    });
    expect(await verifyRequestSignature(req, publicKey)).toEqual({
      ok: false,
      error: 'Signature must cover content-digest for a request with a body',
    });
  });

  test('the audit PoC in full: sign only date, swap method/path/body → FAIL', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    // A signature covering just `date` is cryptographically valid, but leaves
    // method, target and body free to tamper with. The covered-set gate rejects
    // it before the Ed25519 check ever runs.
    const req = await craftSignedRequest(privateKey, ['date']);
    const result = await verifyRequestSignature(req, publicKey);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Signature must cover @method');
  });
});

describe('verifyRequestSignature freshness and alg', () => {
  test('rejects a Date header outside the clock-skew window', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const req = await craftSignedRequest(privateKey, ['@method', '@authority', '@path', 'date'], {
      date: new Date(Date.now() - 10 * 60 * 1000).toUTCString(),
    });
    expect(await verifyRequestSignature(req, publicKey)).toEqual({
      ok: false,
      error: 'Request date outside acceptable window',
    });
  });

  test('rejects a malformed Date header', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const req = await craftSignedRequest(privateKey, ['@method', '@authority', '@path', 'date'], {
      date: 'not-a-date',
    });
    expect(await verifyRequestSignature(req, publicKey)).toEqual({
      ok: false,
      error: 'Invalid Date header format',
    });
  });

  test('rejects a created parameter outside the clock-skew window', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    // Date header stays fresh, so only the created-parameter window can reject.
    const req = await craftSignedRequest(privateKey, ['@method', '@authority', '@path', 'date'], {
      created: Math.floor(Date.now() / 1000) - 10 * 60,
    });
    expect(await verifyRequestSignature(req, publicKey)).toEqual({
      ok: false,
      error: 'Signature created outside acceptable window',
    });
  });

  test('rejects alg that is not ed25519', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const req = await craftSignedRequest(privateKey, ['@method', '@authority', '@path', 'date'], {
      alg: 'rsa-pss-sha512',
    });
    expect(await verifyRequestSignature(req, publicKey)).toEqual({
      ok: false,
      error: 'Unsupported signature algorithm: rsa-pss-sha512',
    });
  });
});
