import { describe, expect, test } from 'bun:test';
import { decrypt, encrypt } from './crypto.js';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

async function encryptOrThrow(plaintext: string, key: string) {
  const result = await encrypt(plaintext, key);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('encrypt/decrypt', () => {
  test('round-trips plaintext back to the original', async () => {
    const sealed = await encryptOrThrow('sk-secret-123', KEY_A);
    const opened = await decrypt(sealed, KEY_A);
    expect(opened).toEqual({ ok: true, value: 'sk-secret-123' });
  });

  test('round-trips unicode and empty strings', async () => {
    for (const plaintext of ['', '密钥🔑 with spaces', 'café-über-naïve']) {
      const sealed = await encryptOrThrow(plaintext, KEY_A);
      const opened = await decrypt(sealed, KEY_A);
      expect(opened).toEqual({ ok: true, value: plaintext });
    }
  });

  test('produces a fresh random IV on every call', async () => {
    const first = await encryptOrThrow('same-input', KEY_A);
    const second = await encryptOrThrow('same-input', KEY_A);
    expect(first.iv).not.toEqual(second.iv);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
  });

  test('fails to decrypt with the wrong key', async () => {
    const sealed = await encryptOrThrow('top-secret', KEY_A);
    const opened = await decrypt(sealed, KEY_B);
    expect(opened.ok).toBe(false);
  });

  test('fails to decrypt when the auth tag is swapped (tamper detection)', async () => {
    const sealed = await encryptOrThrow('top-secret', KEY_A);
    const other = await encryptOrThrow('different', KEY_A);
    const opened = await decrypt({ ...sealed, tag: other.tag }, KEY_A);
    expect(opened.ok).toBe(false);
  });

  test('rejects keys that are not 64 hex chars', async () => {
    const sealed = await encrypt('x', 'tooshort');
    expect(sealed.ok).toBe(false);
    const opened = await decrypt({ ciphertext: '', iv: '', tag: '' }, 'tooshort');
    expect(opened.ok).toBe(false);
  });
});
