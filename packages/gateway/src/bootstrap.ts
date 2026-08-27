import { exportPrivateKey, generateEd25519KeyPair, publicKeyToMultibase } from '@confer/identity';
import { encrypt, newId } from '@confer/shared';
import { and, eq, inArray, isNull, like, ne } from 'drizzle-orm';
import { getDb } from './db/connection.js';
import {
  agents,
  conversationParticipants,
  conversations,
  keypairs,
  peerAgents,
  users,
} from './db/schema.js';
import { getEnv } from './env.js';
import { toDidAuthority } from './lib/public-host.js';
import { instanceDid } from './lib/public-identity.js';

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

// The DID registration hardcoded until 2026-08-27, ignoring PUBLIC_HOST.
const LEGACY_DID = 'did:web:localhost';

// Matches the legacy value itself and anything built on top of it — the
// per-user `…:agents:<name>` form and the `…#key-1` key ids — without matching
// a genuinely different host that merely starts the same way (localhost.dev).
function isLegacyDid(did: string): boolean {
  return did === LEGACY_DID || did.startsWith(`${LEGACY_DID}:`) || did.startsWith(`${LEGACY_DID}#`);
}

// Re-host identities this instance minted under the old hardcoded `localhost`.
//
// Because registration ignored PUBLIC_HOST, every user and agent DID pointed at
// whatever machine happened to resolve it — which, for a peer, is the peer's own
// loopback. Cross-instance A2A therefore could not work at all: the signer's DID
// document was unreachable and `/lookup` by domain rejected the identities as
// not belonging to the advertising host.
//
// Deliberately scoped to the old hardcoded value. A host that has merely changed
// (example.com -> other.com) is an operator decision about an identity peers may
// already have on file, and must not be rewritten behind their back.
// Idempotent: a second run finds nothing.
export async function rehostLegacyDids(): Promise<void> {
  const authority = toDidAuthority(getEnv().PUBLIC_HOST);
  if (authority === 'localhost') return;

  const db = getDb();
  const rehost = (did: string) => `did:web:${authority}${did.slice(LEGACY_DID.length)}`;
  const prefix = `${LEGACY_DID}%`;

  // One transaction: a key_id left behind by a half-applied rewrite would no
  // longer match the DID document built from it, and every inbound A2A
  // signature would fail verification until someone noticed.
  const { userCount, agentCount, keyCount } = await db.transaction(async (tx) => {
    // The LIKE narrows the scan; isLegacyDid then rejects a host that merely
    // shares the prefix, which LIKE cannot express without escaping games. Every
    // select below aliases its DID column to `did`, so the filter and the
    // rewrite read identically across all three tables.
    const legacyOnly = async <T extends { did: string }>(rows: PromiseLike<T[]>): Promise<T[]> =>
      (await rows).filter((row) => isLegacyDid(row.did));

    const staleUsers = await legacyOnly(
      tx.select({ id: users.id, did: users.did }).from(users).where(like(users.did, prefix)),
    );
    for (const row of staleUsers) {
      await tx
        .update(users)
        .set({ did: rehost(row.did), updated_at: new Date() })
        .where(eq(users.id, row.id));
    }

    const staleAgents = await legacyOnly(
      tx.select({ id: agents.id, did: agents.did }).from(agents).where(like(agents.did, prefix)),
    );
    for (const row of staleAgents) {
      await tx
        .update(agents)
        .set({ did: rehost(row.did), updated_at: new Date() })
        .where(eq(agents.id, row.id));
    }

    // Key ids must move with the DID: inbound verification matches the stored
    // key_id against the one in the request's Signature-Input, and the DID
    // document is built from this column.
    const staleKeys = await legacyOnly(
      tx
        .select({ id: keypairs.id, did: keypairs.key_id })
        .from(keypairs)
        .where(like(keypairs.key_id, prefix)),
    );
    for (const row of staleKeys) {
      await tx
        .update(keypairs)
        .set({ key_id: rehost(row.did) })
        .where(eq(keypairs.id, row.id));
    }

    return {
      userCount: staleUsers.length,
      agentCount: staleAgents.length,
      keyCount: staleKeys.length,
    };
  });

  if (userCount + agentCount + keyCount > 0) {
    console.log(
      `Re-hosted ${userCount + agentCount + keyCount} legacy ${LEGACY_DID} identities to ` +
        `did:web:${authority} (${userCount} users, ${agentCount} agents, ${keyCount} keys).`,
    );
  }

  // peer_agents rows describe *remote* parties, so rewriting them would be
  // rewriting somebody else's identity. Say so instead and let the owner re-add.
  const stalePeers = (
    await db.select({ did: peerAgents.did }).from(peerAgents).where(like(peerAgents.did, prefix))
  ).filter((row) => isLegacyDid(row.did));
  if (stalePeers.length > 0) {
    console.warn(
      `${stalePeers.length} peer_agents row(s) still reference ${LEGACY_DID} and will not resolve. ` +
        'Re-add those contacts by their new DID.',
    );
  }
}

// Give A2A conversations created before v0.3.1 the owner participant row they
// were never seeded with.
//
// `GET /conversations` lists purely by participant row, so a thread whose owner
// has none is invisible to them — their own agent answering in a conversation
// they cannot see. v0.3.1 fixed the seeding, but only for threads created after
// it. Idempotent: the left join finds nothing on a second run.
export async function backfillOwnerParticipants(): Promise<void> {
  const db = getDb();

  const orphaned = await db
    .select({ id: conversations.id, owner: conversations.created_by })
    .from(conversations)
    .leftJoin(
      conversationParticipants,
      and(
        eq(conversationParticipants.conversation_id, conversations.id),
        eq(conversationParticipants.participant_type, 'user'),
        eq(conversationParticipants.user_id, conversations.created_by),
      ),
    )
    // Scoped to inbound A2A threads, the only path that ever missed the row.
    // `role: 'owner'` mirrors what that path writes today.
    .where(and(eq(conversations.type, 'direct_agent_agent'), isNull(conversationParticipants.id)));

  if (orphaned.length === 0) return;

  await db.insert(conversationParticipants).values(
    orphaned.map((conv) => ({
      id: newId(),
      conversation_id: conv.id,
      participant_type: 'user',
      user_id: conv.owner,
      role: 'owner',
    })),
  );
  console.log(`Backfilled the owner participant row on ${orphaned.length} A2A conversation(s).`);
}

export async function bootstrap(): Promise<void> {
  const db = getDb();
  const env = getEnv();

  await bootstrapAdmins();
  await rehostLegacyDids();
  await backfillOwnerParticipants();

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
    key_id: `${instanceDid()}#key-1`,
    public_key_multibase: pubMultibase,
    private_key_jwk_encrypted: encryptedKey.value,
  });

  console.log('Instance keypair generated and stored.');
}
