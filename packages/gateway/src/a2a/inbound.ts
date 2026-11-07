import { parsePolicyConfig } from '@confer/agent-runtime';
import { domainFromDid } from '@confer/identity';
import { AppError, newId } from '@confer/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { type agents, conversations, messages, peerContacts } from '../db/schema.js';
import { decideAdmission } from '../lib/a2a-admission.js';
import { runDetached } from '../lib/background.js';
import { requiresCapability, resolveCapability } from '../lib/capability-grants.js';
import { isContact } from '../lib/tenant.js';
import { consumeQuota } from '../middleware/rate-limit.js';
import { broadcastToConversation, sendToUser } from '../ws/handler.js';
import { processA2AMessage } from './answer.js';
import { holdA2AQuestion, upsertConnectionRequest } from './inbound-permissions.js';
import { ensurePeerAgent, resolveOrCreateThread } from './inbound-thread.js';

// What happens to a verified inbound A2A message, from the moment the signer is
// known to the moment the agent loop is (or is not) spawned: gather, decide,
// act. It lives here rather than in a route because there are now TWO wire
// formats reaching it — Confer's native `POST /messages` and the spec's
// `POST /message:send` — and the gates below are the tenant and consent
// boundaries. Duplicating them per binding is exactly how the cross-tenant
// thread-injection bug got written four separate times.

export type InboundAdmission =
  /** Sender is not a contact; the message became a pending connection request. */
  | { status: 'pending_connection' }
  /** Policy refused the sender outright. Nothing was stored. */
  | { status: 'denied' }
  | { status: 'invalid_capability' }
  /** The peer is over its question quota with this owner. Nothing was stored. */
  | { status: 'rate_limited'; retryAfterSeconds: number }
  /** Stored, and held for the owner to approve before the agent answers. */
  | { status: 'held'; messageId: string; conversationId: string }
  /** Stored, and the agent loop is running for it in the background. */
  | { status: 'answering'; messageId: string; conversationId: string }
  /** Stored. An answer or notification never provokes a reply of its own. */
  | { status: 'stored'; messageId: string; conversationId: string };

export interface InboundMessageParams {
  capabilityToken?: string;
  targetAgent: typeof agents.$inferSelect;
  /** The `from` DID on the wire — already checked to sit beneath the signer. */
  senderDid: string;
  /** The cryptographically proven signer, used as the peer's second name. */
  signerDid?: string;
  /** The sender's own thread identifier, if they quoted one. */
  threadId?: string;
  message: {
    type: 'question' | 'answer' | 'notification';
    content: string;
    language?: string;
    context?: Record<string, unknown>;
  };
}

/** Questions one peer may ask one owner. Generous for a person-paced exchange. */
export const PEER_QUESTION_LIMITS = [
  { scope: 'did', limit: 20, windowMs: 60_000 },
  { scope: 'did', limit: 300, windowMs: 24 * 60 * 60_000 },
  { scope: 'domain', limit: 60, windowMs: 60_000 },
] as const;

/** Seconds until the peer may ask again, or 0 when it is within every quota. */
function overQuota(ownerId: string, peerDid: string): number {
  const domain = domainFromDid(peerDid) ?? peerDid;
  for (const { scope, limit, windowMs } of PEER_QUESTION_LIMITS) {
    const who = scope === 'did' ? peerDid : domain;
    const used = consumeQuota(`a2a:${scope}:${windowMs}:${ownerId}:${who}`, limit, windowMs);
    if (!used.ok) return used.retryAfterSeconds;
  }
  return 0;
}

export async function admitInboundMessage(params: InboundMessageParams): Promise<InboundAdmission> {
  const { targetAgent, senderDid, signerDid, threadId, message } = params;
  const db = getDb();
  const grant = params.capabilityToken
    ? await resolveCapability(
        targetAgent.user_id,
        signerDid ?? senderDid,
        params.capabilityToken,
      ).catch((error) => {
        if (error instanceof AppError && error.code === 'invalid_capability') return null;
        throw error;
      })
    : undefined;
  if (grant === null) return { status: 'invalid_capability' };

  const peer = await ensurePeerAgent(targetAgent.user_id, senderDid, signerDid);

  if (grant && grant.peer_id !== peer.id) return { status: 'denied' };

  // A message from an unconnected peer is held as a pending connection request
  // until the owner approves it in the permission inbox. Adding a contact is the
  // consent gate: without it a stranger could spend the owner's model budget.
  if (!(await isContact(targetAgent.user_id, peer.id))) {
    await upsertConnectionRequest(targetAgent.user_id, peer, message.content);
    return { status: 'pending_connection' };
  }

  // Every question costs the owner a model turn, and the IP limit in front of
  // this says nothing about who is asking. So a connected peer gets a quota
  // with each owner — and so does its whole domain, which can mint as many
  // DIDs as it likes. Answers and notifications cost nothing and are not counted.
  if (message.type === 'question') {
    // Once the owner grants scoped access to this contact, omitting the token
    // must not restore the old, broader shared-KB access (including after revocation).
    if (!grant && (await requiresCapability(targetAgent.user_id, peer.id)))
      return { status: 'denied' };
    const over = overQuota(targetAgent.user_id, peer.did);
    if (over) return { status: 'rate_limited', retryAfterSeconds: over };
  }

  const [contact] = await db
    .select({ overrides: peerContacts.policy_overrides_json })
    .from(peerContacts)
    .where(and(eq(peerContacts.user_id, targetAgent.user_id), eq(peerContacts.peer_id, peer.id)))
    .limit(1);

  const admission = decideAdmission({
    peerDid: senderDid,
    agentPolicies: parsePolicyConfig(targetAgent.policies_json),
    contactOverrides: contact?.overrides,
  });

  if (admission === 'deny') return { status: 'denied' };

  // Shared by `allow` and `hold`: the owner sees the inbound message in their IM
  // either way. Only the auto-reply differs (immediate vs. held for approval).
  const conversationId = await resolveOrCreateThread(threadId, peer.id, targetAgent.user_id);

  const cited = z
    .array(
      z.object({
        kb_name: z.string().max(255),
        doc_name: z.string().max(255),
        excerpt: z.string().max(4000),
        score: z.number().finite().optional(),
      }),
    )
    .max(10)
    .safeParse(message.context?.citations);
  const peerCitations =
    message.type !== 'question' && cited.success
      ? cited.data.map((cite) => ({ ...cite, trust_level: 'unverified' }))
      : [];
  const messageId = newId();
  await db.insert(messages).values({
    id: messageId,
    capability_id: grant?.id,
    citations_json: peerCitations.length ? peerCitations : undefined,
    conversation_id: conversationId,
    sender_type: 'peer_agent',
    sender_id: peer.id,
    sender_did: senderDid,
    content_type: 'text',
    content: message.content,
    language: message.language,
    // The LOCAL thread. `thread_root` is char(26) and indexed for our own
    // conversation ids; storing the peer's raw thread id put a foreign — and
    // unvalidated — string there, which any peer could overflow into a 500.
    thread_root: conversationId,
    via: 'a2a',
    delivered_at: new Date(),
  });

  broadcastToConversation(conversationId, {
    type: 'message.new',
    data: {
      id: messageId,
      conversation_id: conversationId,
      sender_type: 'peer_agent',
      sender_id: peer.id,
      content: message.content,
      in_reply_to: threadId,
      citations: peerCitations.map((cite) => ({
        source: `${cite.doc_name}（${cite.kb_name}）`,
        passage: cite.excerpt,
        trust_level: 'unverified',
      })),
    },
  });
  // A peer writing is activity: the thread moves to the top of the owner's list,
  // and comes off the archive shelf if it was there — the way mail does.
  await db
    .update(conversations)
    .set({ updated_at: new Date(), archived_at: null })
    .where(eq(conversations.id, conversationId));

  // `message.new` only reaches sockets already subscribed to this thread. A
  // peer opening a new thread has none, so the owner's list never showed it
  // until they reloaded; this goes to the owner wherever they are.
  sendToUser(targetAgent.user_id, {
    type: 'conversation.updated',
    data: { conversation_id: conversationId },
  });

  // Only a question can be held — an answer or notification never auto-replies,
  // so there is nothing to gate.
  if (admission === 'hold' && message.type === 'question') {
    await holdA2AQuestion({
      userId: targetAgent.user_id,
      agentId: targetAgent.id,
      peer,
      senderDid,
      conversationId,
      peerThreadId: threadId,
      inboundMessageId: messageId,
      content: message.content,
    });
    return { status: 'held', messageId, conversationId };
  }

  // An answer or notification (a peer responding to one of our own consults) is
  // stored and broadcast, but must NOT spawn a reply — otherwise two agents
  // would ping-pong forever.
  if (message.type !== 'question') {
    return { status: 'stored', messageId, conversationId };
  }

  // Registered now, started on the next tick, as `routes/permissions.ts` does
  // for a resumed question: the response goes out first, and the promise is
  // kept so a test's `resetDb` can join the turn instead of truncating over
  // its reply (see `lib/background.ts`).
  runDetached(
    new Promise<void>((tick) => setImmediate(tick)).then(() =>
      processA2AMessage({
        targetAgent,
        capabilityId: grant?.id,
        senderDid,
        senderPeer: peer,
        messageContent: message.content,
        conversationId,
        peerThreadId: threadId,
        inboundMessageId: messageId,
        language: message.language,
      }),
    ),
    (error) => console.error('A2A processing failed:', error),
  );

  return { status: 'answering', messageId, conversationId };
}
