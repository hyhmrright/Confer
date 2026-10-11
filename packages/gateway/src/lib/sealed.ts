import { AppError, decrypt, type EncryptedValue, encrypt } from '@confer/shared';
import { getEnv } from '../env.js';

// A secret kept at rest under ENCRYPTION_KEY (AES-256-GCM): the TOTP seed, a
// peer's webhook credentials. Failure is a 500 — the key is the instance's own,
// so a value it cannot open means the deployment is broken, not the request.

export async function sealSecret(secret: string): Promise<EncryptedValue> {
  const sealed = await encrypt(secret, getEnv().ENCRYPTION_KEY);
  if (!sealed.ok) throw new AppError('encryption_failed', 'Failed to protect the secret', 500);
  return sealed.value;
}

export async function openSecret(sealed: unknown): Promise<string> {
  const opened = await decrypt(sealed as EncryptedValue, getEnv().ENCRYPTION_KEY);
  if (!opened.ok) throw new AppError('decryption_failed', 'Failed to read the secret', 500);
  return opened.value;
}
