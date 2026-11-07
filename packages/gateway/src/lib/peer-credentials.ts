import { AppError, decrypt, type EncryptedValue } from '@confer/shared';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { peerCredentials } from '../db/schema.js';
import { getEnv } from '../env.js';

export async function outboundCapability(
  userId: string,
  peerId: string,
): Promise<string | undefined> {
  const [row] = await getDb()
    .select()
    .from(peerCredentials)
    .where(and(eq(peerCredentials.user_id, userId), eq(peerCredentials.peer_id, peerId)));
  if (!row) return undefined;
  const decrypted = await decrypt(row.token_json as EncryptedValue, getEnv().ENCRYPTION_KEY);
  if (!decrypted.ok)
    throw new AppError(
      'credential_unavailable',
      'Cannot decrypt peer capability; save it again',
      500,
    );
  return decrypted.value;
}
