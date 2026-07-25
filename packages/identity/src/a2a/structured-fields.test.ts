import { describe, expect, test } from 'bun:test';
import {
  parseSignatureInput,
  parseSignatureValue,
  serializeContentDigest,
  serializeSignatureParams,
  serializeSignatureValue,
} from './structured-fields.js';

describe('serializeSignatureParams', () => {
  test('renders the inner list and keyid/created/alg parameters', () => {
    const value = serializeSignatureParams(
      ['@method', '@authority', '@path', 'content-digest', 'date'],
      {
        keyid: 'did:web:vendor.com#key-1',
        created: 1700000000,
        alg: 'ed25519',
      },
    );
    expect(value).toBe(
      '("@method" "@authority" "@path" "content-digest" "date");keyid="did:web:vendor.com#key-1";created=1700000000;alg="ed25519"',
    );
  });
});

describe('parseSignatureInput', () => {
  test('round-trips a serialized params value and preserves the raw substring', () => {
    const params = serializeSignatureParams(['@method', '@authority', '@path', 'date'], {
      keyid: 'did:web:a.com#key-1',
      created: 1700000000,
      alg: 'ed25519',
    });
    const result = parseSignatureInput(`sig1=${params}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.label).toBe('sig1');
      expect(result.value.components).toEqual(['@method', '@authority', '@path', 'date']);
      expect(result.value.keyid).toBe('did:web:a.com#key-1');
      expect(result.value.created).toBe(1700000000);
      expect(result.value.alg).toBe('ed25519');
      // paramsValue is the byte-exact substring after `sig1=`, for base reuse.
      expect(result.value.paramsValue).toBe(params);
    }
  });

  test('leaves created and alg undefined when absent', () => {
    const result = parseSignatureInput('sig1=("@method" "@path");keyid="k"');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.keyid).toBe('k');
      expect(result.value.created).toBeUndefined();
      expect(result.value.alg).toBeUndefined();
    }
  });

  test('rejects a missing keyid parameter', () => {
    const result = parseSignatureInput('sig1=("@method" "@path");created=1700000000');
    expect(result).toEqual({ ok: false, error: 'Signature-Input is missing the keyid parameter' });
  });

  test('rejects a label other than sig1', () => {
    const result = parseSignatureInput('proxy=("@method");keyid="k"');
    expect(result.ok).toBe(false);
  });

  test('rejects a value with no label separator', () => {
    expect(parseSignatureInput('("@method");keyid="k"').ok).toBe(false);
  });

  test('rejects a missing component list', () => {
    expect(parseSignatureInput('sig1=;keyid="k"').ok).toBe(false);
  });

  test('rejects an unterminated component list', () => {
    expect(parseSignatureInput('sig1=("@method";keyid="k"').ok).toBe(false);
  });

  test('rejects a multi-signature (multiple members) as out of scope', () => {
    const result = parseSignatureInput('sig1=("@method");keyid="a",sig2=("@method");keyid="b"');
    expect(result).toEqual({ ok: false, error: 'Multiple signatures are not supported' });
  });

  test('parses a keyid containing reserved-looking characters', () => {
    const result = parseSignatureInput('sig1=("@method");keyid="did:web:x.com:agents:li#key-1"');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.keyid).toBe('did:web:x.com:agents:li#key-1');
  });
});

describe('serializeSignatureValue / parseSignatureValue', () => {
  test('round-trips arbitrary bytes through sig1=:<b64>:', () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255, 42, 128]);
    const serialized = serializeSignatureValue(bytes);
    expect(serialized).toMatch(/^sig1=:[A-Za-z0-9+/=]+:$/);
    const parsed = parseSignatureValue(serialized);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(Array.from(parsed.value)).toEqual(Array.from(bytes));
  });

  test('rejects a value that is not colon-wrapped', () => {
    expect(parseSignatureValue('sig1=abc').ok).toBe(false);
  });

  test('rejects a value with a non-sig1 label', () => {
    expect(parseSignatureValue('proxy=:AAAA:').ok).toBe(false);
  });

  test('rejects a trailing second member (multi-signature)', () => {
    expect(parseSignatureValue('sig1=:AAAA:,proxy=:BBBB:').ok).toBe(false);
  });

  test('rejects non-canonical base64 with slack bits set (signature malleability)', () => {
    // 64 bytes leaves a 1-byte trailing group, encoded as 2 base64 chars + "==".
    // Only the top 2 of the second char's 6 bits carry byte data; the bottom 4
    // are padding that a permissive atob() ignores on decode. If parseSignatureValue
    // didn't re-check canonical form, an attacker could flip those slack bits to
    // mint many distinct Signature header strings that all decode to the same
    // bytes and verify — trivially bypassing a replay-nonce cache keyed on the
    // raw header value (see a2a.ts's Finding C nonce key).
    const bytes = new Uint8Array(64).fill(1);
    const canonical = serializeSignatureValue(bytes);
    const inner = canonical.slice('sig1=:'.length, canonical.length - 1);
    expect(inner.endsWith('==')).toBe(true);

    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lastCharIndex = inner.length - 3;
    const lastVal = alphabet.indexOf(inner[lastCharIndex] as string);
    const alteredVal = (lastVal & 0b110000) | ((lastVal & 0b001111) ^ 0b000001);
    const altered =
      inner.slice(0, lastCharIndex) + alphabet[alteredVal] + inner.slice(lastCharIndex + 1);
    expect(altered).not.toBe(inner);

    const malleable = `sig1=:${altered}:`;
    const parsed = parseSignatureValue(malleable);
    expect(parsed.ok).toBe(false);
  });
});

describe('serializeContentDigest', () => {
  test('wraps a base64 digest in the RFC 9530 sha-256 form', () => {
    expect(serializeContentDigest('X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=')).toBe(
      'sha-256=:X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=:',
    );
  });
});
