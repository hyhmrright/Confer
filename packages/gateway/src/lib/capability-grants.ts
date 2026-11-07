import { AppError } from '@confer/shared';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { capabilityGrants, knowledgeBases } from '../db/schema.js';
import { hashApiToken } from './api-tokens.js';

/** A grant narrows existing contact/policy access; it never replaces signature or consent. */
export async function resolveCapability(ownerId: string, signerDid: string, credential: string) {
  const [grant] = await getDb()
    .select()
    .from(capabilityGrants)
    .where(
      and(
        eq(capabilityGrants.user_id, ownerId),
        eq(capabilityGrants.signer_did, signerDid),
        eq(capabilityGrants.token_hash, hashApiToken(credential)),
        isNull(capabilityGrants.revoked_at),
        gt(capabilityGrants.expires_at, new Date()),
      ),
    )
    .limit(1);
  if (!grant) throw new AppError('invalid_capability', 'Invalid or expired capability', 403);
  return grant;
}

/** Re-read before answering, including held turns: revoked grants cannot resume. */
export async function capabilityScope(id: string, ownerId: string, peerId: string) {
  const [grant] = await getDb()
    .select()
    .from(capabilityGrants)
    .where(
      and(
        eq(capabilityGrants.id, id),
        eq(capabilityGrants.user_id, ownerId),
        eq(capabilityGrants.peer_id, peerId),
        isNull(capabilityGrants.revoked_at),
        gt(capabilityGrants.expires_at, new Date()),
      ),
    )
    .limit(1);
  if (!grant) return null;
  const shared = await getDb()
    .select({ id: knowledgeBases.id })
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.user_id, ownerId), eq(knowledgeBases.shared_with_peers, true)));
  // Sharing can be withdrawn after issuance. A deleted KB can never reappear by id.
  return shared.filter((kb) => grant.kb_ids.includes(kb.id)).map((kb) => kb.id);
}

/** Retain the requirement after revocation; omitting a grant must never widen access. */
export async function requiresCapability(ownerId: string, peerId: string): Promise<boolean> {
  const [grant] = await getDb()
    .select({ id: capabilityGrants.id })
    .from(capabilityGrants)
    .where(and(eq(capabilityGrants.user_id, ownerId), eq(capabilityGrants.peer_id, peerId)))
    .limit(1);
  return !!grant;
}
