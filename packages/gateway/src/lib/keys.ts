import {
  exportPrivateKey,
  generateEd25519KeyPair,
  type PublishedKey,
  publicKeyToMultibase,
} from '@confer/identity';
import { AppError, newId } from '@confer/shared';
import { and, count, desc, eq, gt, isNull, or, type SQL, sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { keypairs } from '../db/schema.js';
import { uniqueViolation } from './db-errors.js';
import { sealSecret } from './sealed.js';

/**
 * Signing keys and their lifecycle (docs/03-protocol.md, "key rotation").
 *
 * A key is one of three things, read off two columns:
 *   - current:  active, no `revoked_at` — the newest such key signs.
 *   - retiring: active, `revoked_at` in the future — published so a message
 *     signed before the rotation still verifies, but never used to sign.
 *   - revoked:  inactive, or `revoked_at` passed — gone from the DID document.
 * Rotation turns the current key into a retiring one and mints a new current
 * one; revocation (for a key believed compromised) takes one out at once.
 */

/** How long a replaced key stays in the DID document. */
export const KEY_OVERLAP_MS = 30 * 24 * 60 * 60 * 1000;

type KeyRow = typeof keypairs.$inferSelect;

export const userKeys = (userId: string): SQL =>
  and(eq(keypairs.owner_type, 'user'), eq(keypairs.owner_id, userId)) as SQL;
export const instanceKeys = (): SQL => eq(keypairs.owner_type, 'instance');

const live = (now: Date) =>
  and(eq(keypairs.is_active, true), or(isNull(keypairs.revoked_at), gt(keypairs.revoked_at, now)));

/** Every key a verifier should accept for this owner right now, newest first. */
export async function publishedKeys(owner: SQL): Promise<PublishedKey[]> {
  // Only public columns — never `private_key_jwk_encrypted`.
  const rows = await getDb()
    .select({ key_id: keypairs.key_id, public_key_multibase: keypairs.public_key_multibase })
    .from(keypairs)
    .where(and(owner, live(new Date())))
    .orderBy(desc(keypairs.created_at), desc(keypairs.id));
  return rows.map((r) => ({ keyId: r.key_id, publicKeyMultibase: r.public_key_multibase }));
}

/** The key that signs for this owner: the newest one not on its way out. */
export async function currentKey(owner: SQL): Promise<KeyRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(keypairs)
    .where(and(owner, eq(keypairs.is_active, true), isNull(keypairs.revoked_at)))
    .orderBy(desc(keypairs.created_at), desc(keypairs.id))
    .limit(1);
  return row;
}

/** A fresh key pair, sealed and encoded — the slow, fallible part, done outside any transaction. */
async function newKeyMaterial() {
  const pair = await generateEd25519KeyPair();
  return {
    public_key_multibase: await publicKeyToMultibase(pair.publicKey),
    private_key_jwk_encrypted: await sealSecret(
      JSON.stringify(await exportPrivateKey(pair.privateKey)),
    ),
  };
}

type Executor = Pick<ReturnType<typeof getDb>, 'select' | 'insert' | 'update' | 'execute'>;

/** Insert the account's next key, `<did>#key-<n>`, numbered after every key it has held. */
async function insertNextKey(
  db: Executor,
  userId: string,
  did: string,
  material: Awaited<ReturnType<typeof newKeyMaterial>>,
): Promise<string> {
  const [held] = await db.select({ n: count() }).from(keypairs).where(userKeys(userId));
  const keyId = `${did}#key-${(held?.n ?? 0) + 1}`;
  await db.insert(keypairs).values({
    id: newId(),
    owner_type: 'user',
    owner_id: userId,
    key_id: keyId,
    ...material,
  });
  return keyId;
}

/** The account's first signing key, at registration. */
export async function mintUserKey(userId: string, did: string): Promise<string> {
  return insertNextKey(getDb(), userId, did, await newKeyMaterial());
}

/**
 * Replace the account's signing key. The old one keeps verifying for
 * KEY_OVERLAP_MS — a message already on its way, or a peer still holding our
 * document in cache, must not start failing the moment the owner clicks.
 *
 * Retiring the old key and inserting the new one are one transaction, under a
 * per-account lock: done as two steps, a failed insert left the account with
 * no key that could sign, and two rotations at once (a double click) raced to
 * the same `#key-<n>`.
 */
export async function rotateUserKey(userId: string, did: string): Promise<string> {
  const material = await newKeyMaterial();
  const retiresAt = new Date(Date.now() + KEY_OVERLAP_MS);
  try {
    return await getDb().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`keys:${userId}`}))`);
      await tx
        .update(keypairs)
        .set({ revoked_at: retiresAt })
        .where(and(userKeys(userId), eq(keypairs.is_active, true), isNull(keypairs.revoked_at)));
      return insertNextKey(tx, userId, did, material);
    });
  } catch (error) {
    if (uniqueViolation(error) !== null) {
      throw new AppError('rotation_conflict', 'Another rotation is in progress', 409);
    }
    throw error;
  }
}

/**
 * Take a key out of the DID document now — for one believed compromised. The
 * key that signs cannot be revoked this way, or the account would have none:
 * rotate first, then revoke the key that rotation retired.
 */
export async function revokeUserKey(userId: string, keyId: string): Promise<void> {
  const current = await currentKey(userKeys(userId));
  if (current?.key_id === keyId) {
    throw new AppError('rotate_first', 'Rotate to a new key before revoking the one in use', 409);
  }
  const revoked = await getDb()
    .update(keypairs)
    .set({ is_active: false, revoked_at: new Date() })
    .where(and(userKeys(userId), eq(keypairs.key_id, keyId), eq(keypairs.is_active, true)))
    .returning({ id: keypairs.id });
  if (revoked.length === 0) throw new AppError('not_found', 'No such active key', 404);
}

export interface KeyView {
  key_id: string;
  created_at: Date;
  status: 'current' | 'retiring' | 'revoked';
  retires_at: Date | null;
}

/** The account's keys as the owner manages them, newest first. */
export async function listUserKeys(userId: string): Promise<KeyView[]> {
  const rows = await getDb()
    .select({
      key_id: keypairs.key_id,
      created_at: keypairs.created_at,
      is_active: keypairs.is_active,
      revoked_at: keypairs.revoked_at,
    })
    .from(keypairs)
    .where(userKeys(userId))
    .orderBy(desc(keypairs.created_at), desc(keypairs.id));
  const now = Date.now();
  return rows.map((r) => ({
    key_id: r.key_id,
    created_at: r.created_at,
    status:
      !r.is_active || (r.revoked_at && r.revoked_at.getTime() <= now)
        ? 'revoked'
        : r.revoked_at
          ? 'retiring'
          : 'current',
    retires_at: r.is_active ? r.revoked_at : null,
  }));
}
