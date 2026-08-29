import { decrypt, type EncryptedValue, err, ok, type Result } from '@confer/shared';
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
 * Load the signing key for an account's outbound A2A, and decrypt it. The
 * private key is stored AES-256-GCM encrypted (see auth.ts); callers must never
 * hold the plaintext beyond signing a single request.
 *
 * The key is the OWNER's (`owner_type: 'user'`, keyed by user id), because that
 * is the only key registration mints and the only one anything publishes: the
 * document at `/agents/<username>/did.json` is built from exactly this row, and
 * a peer verifying our signature fetches that document to find the key. Signing
 * with anything else produces a `keyid` no verifier can resolve.
 *
 * This used to query `owner_type: 'agent'` keyed by the agent id — a row no
 * code path has ever written, so every outbound consult and every A2A reply
 * failed with `no_signing_key` before it reached the network. It went unseen
 * because the one test covering the path hand-seeded that row itself.
 */
export async function loadOwnerSigningKey(
  userId: string,
): Promise<Result<AgentSigningKey, string>> {
  const db = getDb();
  const [keypair] = await db
    .select()
    .from(keypairs)
    .where(
      and(
        eq(keypairs.owner_type, 'user'),
        eq(keypairs.owner_id, userId),
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
