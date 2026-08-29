import { newId } from '@confer/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { conversationParticipants, conversations, peerAgents } from '../db/schema.js';
import { derivedId } from '../lib/derived-id.js';
import { isOwnIdentity, resolveDidDocument } from '../lib/did-resolution.js';
import { upsertPeerAgent } from '../lib/peer-agent.js';
import { selfA2AEndpoint } from '../lib/public-identity.js';
import { isContact } from '../lib/tenant.js';

// Resolve a peer's A2A service endpoint from its DID document. Returns '' if
// the DID cannot be resolved or advertises no service endpoint.
async function resolvePeerEndpoint(did: string): Promise<string> {
  // Every identity on an instance shares that instance's A2A endpoint — the
  // same rule contact discovery relies on when it reads `.well-known/agents.json`
  // — so anything under our own authority is reachable here without a lookup.
  // It has to be short-circuited rather than resolved: a Confer peer signs as
  // its owner but sends `from` as its AGENT DID (`…:agents:<user>:agent`), and
  // no route serves a document for that, so resolution would come back empty
  // and the peer would be recorded with nowhere to reply to.
  if (isOwnIdentity(did)) return selfA2AEndpoint();

  const result = await resolveDidDocument(did);
  if (!result.ok) return '';
  return result.value.service?.find((s) => s.serviceEndpoint)?.serviceEndpoint ?? '';
}

/**
 * The peer row this owner knows the sender by, created on first contact with
 * its endpoint resolved up front so a reply can be sent once the owner
 * approves. Null if the peer cannot be persisted.
 *
 * One peer reaches us under two names, and which one arrives depends on how the
 * contact was added. `from` carries the AGENT did (`<owner>:agent`), which is
 * what public discovery lists — but the only DID anyone can *resolve* is the
 * owner's, so that is what a lookup by DID stores. Keyed on `from` alone, a
 * contact added from a pasted DID never matched: the peer's own replies came
 * back as a connection request from a stranger, and the answer to your own
 * question sat in the permission inbox waiting for you to admit the person you
 * had just asked.
 *
 * `signerDid` is the identity whose document was verified, and
 * `isSenderAuthorized` has already established that `from` sits beneath it — so
 * the two name one principal and either row is a legitimate match. Prefer the
 * one this owner has actually connected to.
 */
export async function ensurePeerAgent(
  ownerId: string,
  fromDid: string,
  signerDid?: string,
): Promise<typeof peerAgents.$inferSelect | null> {
  const db = getDb();
  const names = signerDid && signerDid !== fromDid ? [fromDid, signerDid] : [fromDid];
  const known = await db.select().from(peerAgents).where(inArray(peerAgents.did, names));

  for (const row of known) {
    if (await isContact(ownerId, row.id)) return row;
  }
  const existing = known.find((r) => r.did === fromDid) ?? known[0];
  if (existing) return existing;

  const created = await upsertPeerAgent({
    did: fromDid,
    endpoint: await resolvePeerEndpoint(fromDid),
  });
  return created ?? null;
}

// Whether `threadId` names a conversation this owner has with this peer — i.e.
// the peer is answering something we sent, and quoted the thread we asked in.
//
// Both halves of the check matter. Peer rows are global (keyed by DID), so a
// peer connected to two owners passes a peer-only participant check on either
// owner's thread — it could then steer a message addressed to one owner's agent
// into the other owner's conversation, where the reply would be broadcast to
// the wrong owner and that owner's history would feed the wrong agent's context.
async function ownsThreadWithPeer(
  threadId: string,
  peerId: string,
  userId: string,
): Promise<boolean> {
  const [member] = await getDb()
    .select({ id: conversationParticipants.id })
    .from(conversationParticipants)
    .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversation_id))
    .where(
      and(
        eq(conversationParticipants.conversation_id, threadId),
        eq(conversationParticipants.peer_id, peerId),
        eq(conversations.created_by, userId),
      ),
    )
    .limit(1);
  return member !== undefined;
}

/**
 * The conversation an inbound message belongs to, created on first use and
 * seeded with both the owner and the peer as participants.
 *
 * Thread ids are per-side: the id a peer sends is theirs, and names nothing
 * here. Treating an unrecognised one as "no thread" — which is what this did —
 * meant the receiving side opened a NEW conversation for every inbound message.
 * A question and its follow-up never sat together, the owner's list filled with
 * one-line threads, and `loadA2AHistory` had nothing to load, so the agent
 * answered every message as if it were the first.
 *
 * Deriving our id from theirs fixes that without storing the mapping, and
 * without a race: two messages arriving at once collide on the primary key
 * instead of creating two threads. A peer's thread id is only unique to that
 * peer, so it is scoped by both the owner and the peer row.
 */
export async function resolveOrCreateThread(
  threadId: string | undefined,
  peerId: string,
  userId: string,
): Promise<string> {
  const db = getDb();

  if (threadId && (await ownsThreadWithPeer(threadId, peerId, userId))) return threadId;

  const convId = threadId ? derivedId('a2a-thread', userId, peerId, threadId) : newId();

  // Atomic so a conversation row can never persist without its participants,
  // and conflict-safe so the second concurrent message just joins the thread
  // the first one created. The owner is seeded alongside the peer: the
  // conversation list and the per-conversation read gates are both keyed on a
  // participant row, so without it the owner cannot see the thread their own
  // agent is answering in.
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(conversations)
      .values({ id: convId, type: 'direct_agent_agent', created_by: userId })
      .onConflictDoNothing()
      .returning({ id: conversations.id });
    if (inserted.length === 0) return;

    await tx.insert(conversationParticipants).values([
      {
        id: newId(),
        conversation_id: convId,
        participant_type: 'user',
        user_id: userId,
        role: 'owner',
      },
      {
        id: newId(),
        conversation_id: convId,
        participant_type: 'peer_agent',
        peer_id: peerId,
        role: 'member',
      },
    ]);
  });

  return convId;
}
