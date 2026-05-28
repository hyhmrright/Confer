import { type Result, err, ok } from './result.js';

export interface EncryptedValue {
  ciphertext: string;
  iv: string;
  tag: string;
}

async function importAesKey(hexKey: string, usage: KeyUsage): Promise<Result<CryptoKey, string>> {
  if (hexKey.length !== 64) {
    return err('Encryption key must be 64 hex characters (32 bytes)');
  }
  const keyBytes = hexToBytes(hexKey);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    'AES-GCM',
    false,
    [usage],
  );
  return ok(key);
}

export async function encrypt(
  plaintext: string,
  hexKey: string,
): Promise<Result<EncryptedValue, string>> {
  const keyResult = await importAesKey(hexKey, 'encrypt');
  if (!keyResult.ok) return keyResult;

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    keyResult.value,
    encoded,
  );

  const ciphertextBytes = new Uint8Array(encrypted.slice(0, encrypted.byteLength - 16));
  const tagBytes = new Uint8Array(encrypted.slice(encrypted.byteLength - 16));

  return ok({
    ciphertext: bytesToBase64(ciphertextBytes),
    iv: bytesToBase64(iv),
    tag: bytesToBase64(tagBytes),
  });
}

export async function decrypt(
  value: EncryptedValue,
  hexKey: string,
): Promise<Result<string, string>> {
  const keyResult = await importAesKey(hexKey, 'decrypt');
  if (!keyResult.ok) return keyResult;

  const iv = base64ToBytes(value.iv);
  const ciphertext = base64ToBytes(value.ciphertext);
  const tag = base64ToBytes(value.tag);

  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      keyResult.value,
      combined.buffer as ArrayBuffer,
    );
    return ok(new TextDecoder().decode(decrypted));
  } catch {
    return err('Decryption failed: invalid key or corrupted data');
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
