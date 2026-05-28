import { describe, expect, test } from 'bun:test';
import {
  exportPrivateKey,
  generateEd25519KeyPair,
  importPrivateKey,
  multibaseToPublicKey,
  publicKeyToMultibase,
} from './keypair.js';

describe('generateEd25519KeyPair', () => {
  test('produces an Ed25519 public/private key pair', async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    expect(publicKey.type).toBe('public');
    expect(privateKey.type).toBe('private');
    expect(publicKey.algorithm.name).toBe('Ed25519');
  });

  test('produces a distinct key on each call', async () => {
    const a = await publicKeyToMultibase((await generateEd25519KeyPair()).publicKey);
    const b = await publicKeyToMultibase((await generateEd25519KeyPair()).publicKey);
    expect(a).not.toBe(b);
  });
});

describe('publicKeyToMultibase / multibaseToPublicKey', () => {
  test('round-trips a public key through multibase', async () => {
    const { publicKey } = await generateEd25519KeyPair();
    const multibase = await publicKeyToMultibase(publicKey);
    expect(multibase.startsWith('z')).toBe(true);

    const decoded = await multibaseToPublicKey(multibase);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      // Re-encoding the decoded key must reproduce the same multibase string.
      expect(await publicKeyToMultibase(decoded.value)).toBe(multibase);
    }
  });

  test('rejects a string without the multibase prefix', async () => {
    const result = await multibaseToPublicKey('6MkBadPrefix');
    expect(result).toEqual({ ok: false, error: 'Invalid multibase prefix' });
  });

  test('rejects characters outside the base58btc alphabet', async () => {
    // 0, O, I and l are excluded from the base58btc alphabet.
    const result = await multibaseToPublicKey('z0OIl');
    expect(result).toEqual({ ok: false, error: 'Invalid base58btc encoding' });
  });

  test('rejects a non-Ed25519 multicodec prefix', async () => {
    // 'z1111' decodes to leading zero bytes, so the 0xed01 prefix check fails.
    const result = await multibaseToPublicKey('z1111');
    expect(result).toEqual({ ok: false, error: 'Invalid Ed25519 multicodec prefix' });
  });
});

describe('exportPrivateKey / importPrivateKey', () => {
  test('round-trips a private key through JWK', async () => {
    const { privateKey } = await generateEd25519KeyPair();
    const jwk = await exportPrivateKey(privateKey);
    expect(jwk.crv).toBe('Ed25519');

    const reimported = await importPrivateKey(jwk);
    const jwk2 = await exportPrivateKey(reimported);
    expect(jwk2.d).toBe(jwk.d);
    expect(jwk2.x).toBe(jwk.x);
  });
});
