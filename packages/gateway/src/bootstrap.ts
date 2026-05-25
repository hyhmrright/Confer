import { getDb } from './db/connection.js';
import { keypairs } from './db/schema.js';
import { eq } from 'drizzle-orm';
import { newId, encrypt } from '@confer/shared';
import { generateEd25519KeyPair, publicKeyToMultibase, exportPrivateKey } from '@confer/identity';
import { getEnv } from './env.js';

export async function bootstrap(): Promise<void> {
  const db = getDb();
  const env = getEnv();

  const [existing] = await db
    .select()
    .from(keypairs)
    .where(eq(keypairs.owner_type, 'instance'))
    .limit(1);

  if (existing) return;

  console.log('Generating instance Ed25519 keypair...');
  const keyPair = await generateEd25519KeyPair();
  const pubMultibase = await publicKeyToMultibase(keyPair.publicKey);
  const privJwk = await exportPrivateKey(keyPair.privateKey);
  const encryptedKey = await encrypt(JSON.stringify(privJwk), env.ENCRYPTION_KEY);
  if (!encryptedKey.ok) {
    throw new Error(`Failed to encrypt instance keypair: ${encryptedKey.error}`);
  }

  await db.insert(keypairs).values({
    id: newId(),
    owner_type: 'instance',
    owner_id: 'system',
    key_id: 'did:web:localhost#key-1',
    public_key_multibase: pubMultibase,
    private_key_jwk_encrypted: encryptedKey.value,
  });

  console.log('Instance keypair generated and stored.');
}
