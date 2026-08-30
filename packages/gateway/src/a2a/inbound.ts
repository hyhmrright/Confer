import { parsePolicyConfig } from '@confer/agent-runtime';
import { newId } from '@confer/shared';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { type agents, messages, peerContacts } from '../db/schema.js';
import { decideAdmission } from '../lib/a2a-admission.js';
import { isContact } from '../lib/tenant.js';
import { broadcastToConversation } from '../ws/handler.js';
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
  /** Stored, and held for the owner to approve before the agent answers. */
  | { status: 'held'; messageId: string; conversationId: string }
  /** Stored, and the agent loop is running for it in the background. */
  | { status: 'answering'; messageId: string; conversationId: string }
  /** Stored. An answer or notification never provokes a reply of its own. */
  | { status: 'stored'; messageId: string; conversationId: string };

export interface InboundMessageParams {
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
  };
}

export async function admitInboundMessage(params: InboundMessageParams): Promise<InboundAdmission> {
  const { targetAgent, senderDid, signerDid, threadId, message } = params;
  const db = getDb();

  const peer = await ensurePeerAgent(targetAgent.user_id, senderDid, signerDid);
  if (!peer) {
    throw new Error(`Failed to resolve peer agent for ${senderDid}`);
  }

  // A message from an unconnected peer is held as a pending connection request
  // until the owner approves it in the permission inbox. Adding a contact is the
  // consent gate: without it a stranger could spend the owner's model budget.
  if (!(await isContact(targetAgent.user_id, peer.id))) {
    await upsertConnectionRequest(targetAgent.user_id, peer, message.content);
    return { status: 'pending_connection' };
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

  const messageId = newId();
  await db.insert(messages).values({
    id: messageId,
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
    },
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

  setImmediate(async () => {
    try {
      await processA2AMessage({
        targetAgent,
        senderDid,
        senderPeer: peer,
        messageContent: message.content,
        conversationId,
        peerThreadId: threadId,
        inboundMessageId: messageId,
      });
    } catch (error) {
      console.error('A2A processing failed:', error);
    }
  });

  return { status: 'answering', messageId, conversationId };
}
