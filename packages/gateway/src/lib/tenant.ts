import { AppError } from '@confer/shared';
import { and, eq } from 'drizzle-orm';
import { type Database, getDb } from '../db/connection.js';
import { conversationParticipants, conversations, peerContacts } from '../db/schema.js';

// Owner-scoping gates for the tables that are NOT per-tenant.
//
// `peer_agents` rows are globally unique by DID: one peer connected to several
// users shares a single row and a single `peer_id`. So any check written as
// "does this peer_id exist / participate / have access" is NOT tenant-isolated —
// it passes for every owner that peer is connected to. Adding the owner
// constraint is the whole of the fix, and forgetting it once already produced a
// real cross-tenant A2A thread injection (fixed in 1a4308b).
//
// The rule used to live only in prose, re-implemented inline at every query
// site. It lives here now so there is exactly one place to get it right, and so
// a reviewer can check tenant isolation by reading one file instead of forty
// call sites.
//
// Every function takes an optional `db`. That is the injection seam: the gateway
// otherwise reaches `getDb()` as a module singleton, which cannot be substituted
// in a unit test without `mock.module` — and that pollutes the process globally
// and takes the real-stack integration tests down with it (it once caused 102
// false failures). Passing a handle costs nothing at the call sites, which all
// keep working unchanged, and makes these gates testable in isolation.

// True when `userId` has connected to `peerId`. The consent gate for inbound
// A2A: an agent only spends its owner's LLM budget for peers the owner accepted.
export async function isContact(
  userId: string,
  peerId: string,
  db: Database = getDb(),
): Promise<boolean> {
  const [contact] = await db
    .select({ id: peerContacts.id })
    .from(peerContacts)
    .where(and(eq(peerContacts.user_id, userId), eq(peerContacts.peer_id, peerId)))
    .limit(1);
  return Boolean(contact);
}

// Same check, as an assertion, for user-facing routes that act on a peer
// (consulting it, writing project memory for it). 403 rather than 404: the
// caller supplied the peer id, so its existence is not what we are hiding.
export async function assertIsContact(
  userId: string,
  peerId: string,
  db: Database = getDb(),
): Promise<void> {
  if (!(await isContact(userId, peerId, db))) {
    throw new AppError('not_a_contact', 'Peer is not a contact', 403);
  }
}

// Membership gate for user-facing conversation routes: the caller must be a
// participant of `convId`, else a 403.
//
// NOTE: this is the membership check. Destructive or owner-only operations
// (consult routes, conversation delete) use the stricter `assertOwnsConversation`
// below — being a participant is not enough to delete a shared conversation.
export async function assertIsConversationParticipant(
  userId: string,
  convId: string,
  db: Database = getDb(),
): Promise<void> {
  const [participant] = await db
    .select({ id: conversationParticipants.id })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversation_id, convId),
        eq(conversationParticipants.user_id, userId),
      ),
    )
    .limit(1);

  if (!participant) {
    throw new AppError('forbidden', 'Not a participant', 403);
  }
}

// Ownership gate for destructive/owner-only conversation operations: the caller
// must be the conversation's creator. Returns 404 (not 403) so existence isn't
// leaked to non-owners. A mere participant of a shared conversation cannot pass.
export async function assertOwnsConversation(
  userId: string,
  convId: string,
  db: Database = getDb(),
): Promise<void> {
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, convId), eq(conversations.created_by, userId)))
    .limit(1);

  if (!conv) {
    throw new AppError('not_found', 'Conversation not found', 404);
  }
}
