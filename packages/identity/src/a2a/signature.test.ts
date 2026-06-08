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
