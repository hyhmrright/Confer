import { type Result, err, ok } from '@confer/shared';

export interface KeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

const MULTIBASE_PREFIX = 'z';

export async function generateEd25519KeyPair(): Promise<KeyPair> {
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  return { publicKey: pair.publicKey, privateKey: pair.privateKey };
}

export async function publicKeyToMultibase(key: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  const multicodec = new Uint8Array(2 + raw.length);
  multicodec[0] = 0xed;
  multicodec[1] = 0x01;
  multicodec.set(raw, 2);
  return MULTIBASE_PREFIX + base58btcEncode(multicodec);
}

export async function multibaseToPublicKey(multibase: string): Promise<Result<CryptoKey, string>> {
  if (!multibase.startsWith(MULTIBASE_PREFIX)) {
    return err('Invalid multibase prefix');
  }

  const decoded = base58btcDecode(multibase.slice(1));
  if (!decoded) {
    return err('Invalid base58btc encoding');
  }
  if (decoded[0] !== 0xed || decoded[1] !== 0x01) {
    return err('Invalid Ed25519 multicodec prefix');
  }

  const raw = decoded.slice(2);
  const key = await crypto.subtle.importKey('raw', raw, 'Ed25519', true, ['verify']);
  return ok(key);
}

export async function exportPrivateKey(key: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', key);
}

export async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, 'Ed25519', true, ['sign']);
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58btcEncode(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! * 256;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let result = '';
  for (const byte of bytes) {
    if (byte === 0) result += BASE58_ALPHABET[0];
    else break;
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]!];
  }
  return result;
}

function base58btcDecode(str: string): Uint8Array | null {
  const bytes = [0];
  for (const char of str) {
    const value = BASE58_ALPHABET.indexOf(char);
    if (value === -1) return null;

    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  let leading = 0;
  for (const char of str) {
    if (char === BASE58_ALPHABET[0]) leading++;
    else break;
  }

  const result = new Uint8Array(leading + bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    result[result.length - 1 - i] = bytes[i]!;
  }
  return result;
}
