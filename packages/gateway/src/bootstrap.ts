import { exportPrivateKey, generateEd25519KeyPair, publicKeyToMultibase } from '@confer/identity';
import { encrypt, newId } from '@confer/shared';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { getDb } from './db/connection.js';
import { keypairs, users } from './db/schema.js';
import { getEnv } from './env.js';

// Promote the accounts named in ADMIN_USERNAMES to the 'admin' role. Idempotent:
// accounts already admin (or not yet registered) are left untouched. This is the
// bootstrap path for the first admin — declarative and replayable.
export async function bootstrapAdmins(): Promise<void> {
  const db = getDb();
  const env = getEnv();

  const names = env.ADMIN_USERNAMES.split(',')
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  if (names.length === 0) return;

  const promoted = await db
    .update(users)
    .set({ role: 'admin', updated_at: new Date() })
    .where(and(inArray(users.username, names), ne(users.role, 'admin')))
    .returning({ username: users.username });

  if (promoted.length > 0) {
    console.log(`Promoted to admin: ${promoted.map((u) => u.username).join(', ')}`);
  }
}

export async function bootstrap(): Promise<void> {
  const db = getDb();
  const env = getEnv();

  await bootstrapAdmins();

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
