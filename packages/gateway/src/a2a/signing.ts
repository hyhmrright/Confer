import { type EncryptedValue, type Result, decrypt, err, ok } from '@confer/shared';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { keypairs } from '../db/schema.js';
import { getEnv } from '../env.js';

export interface AgentSigningKey {
  keyId: string;
  /** Decrypted private key as a JWK JSON string, ready for `sendA2AMessage`. */
  privateKeyJwk: string;
}

/**
 * Load an agent's active signing key and decrypt it. The private key is stored
 * AES-256-GCM encrypted (see auth.ts); callers must never hold the plaintext
 * beyond signing a single request.
 */
export async function loadActiveAgentKey(
  agentId: string,
): Promise<Result<AgentSigningKey, string>> {
  const db = getDb();
  const [keypair] = await db
    .select()
    .from(keypairs)
    .where(
      and(
        eq(keypairs.owner_type, 'agent'),
        eq(keypairs.owner_id, agentId),
        eq(keypairs.is_active, true),
      ),
    )
    .limit(1);

  if (!keypair) return err('no_signing_key');

  const decrypted = await decrypt(
    keypair.private_key_jwk_encrypted as EncryptedValue,
    getEnv().ENCRYPTION_KEY,
  );
  if (!decrypted.ok) return err('key_decrypt_failed');

  return ok({ keyId: keypair.key_id, privateKeyJwk: decrypted.value });
}
