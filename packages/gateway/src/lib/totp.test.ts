import { describe, expect, test } from 'bun:test';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUri,
  totpCode,
  totpStep,
  verifyTotp,
} from './totp.js';

// RFC 6238 Appendix B, SHA-1, key "12345678901234567890". The RFC lists
// 8-digit codes; a 6-digit code is the same number mod 10^6.
const RFC_KEY = base32Encode(Buffer.from('12345678901234567890'));
const RFC_VECTORS: Array<[number, string]> = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

describe('totp', () => {
  test.each(RFC_VECTORS)('matches RFC 6238 at T=%d', (seconds, code) => {
    expect(totpCode(RFC_KEY, totpStep(seconds * 1000))).toBe(code);
  });

  test('base32 round-trips, ignoring case, spaces and padding', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const encoded = base32Encode(bytes);
    expect(base32Decode(encoded)).toEqual(bytes);
    expect(base32Decode(`${encoded.toLowerCase().slice(0, 4)} ${encoded.slice(4)}==`)).toEqual(
      bytes,
    );
  });

  test('a generated secret is 160 bits', () => {
    expect(base32Decode(generateTotpSecret())).toHaveLength(20);
  });

  test('accepts one step of drift either way, and nothing further', () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    for (const offset of [-1, 0, 1]) {
      expect(verifyTotp(RFC_KEY, totpCode(RFC_KEY, step + offset), now, null)).toBe(step + offset);
    }
    expect(verifyTotp(RFC_KEY, totpCode(RFC_KEY, step + 2), now, null)).toBeNull();
    expect(verifyTotp(RFC_KEY, totpCode(RFC_KEY, step - 2), now, null)).toBeNull();
  });

  // A code seen over a shoulder is good for up to 90 seconds; once used, never.
  test('refuses a code from a step already used', () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    const code = totpCode(RFC_KEY, step);
    expect(verifyTotp(RFC_KEY, code, now, step)).toBeNull();
    expect(verifyTotp(RFC_KEY, code, now, step - 1)).toBe(step);
  });

  test('rejects a code of the wrong length without comparing it', () => {
    expect(verifyTotp(RFC_KEY, '12345', Date.now(), null)).toBeNull();
    expect(verifyTotp(RFC_KEY, '1234567', Date.now(), null)).toBeNull();
  });

  test('builds the URI authenticator apps scan', () => {
    const uri = otpauthUri('ABCDEF', 'alice', 'Confer');
    expect(uri.startsWith('otpauth://totp/Confer%3Aalice?')).toBe(true);
    expect(new URL(uri).searchParams.get('secret')).toBe('ABCDEF');
    expect(new URL(uri).searchParams.get('issuer')).toBe('Confer');
  });
});
