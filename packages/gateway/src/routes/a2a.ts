import { parsePolicyConfig } from '@confer/agent-runtime';
import { AppError, newId } from '@confer/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { processA2AMessage } from '../a2a/answer.js';
import { holdA2AQuestion, upsertConnectionRequest } from '../a2a/inbound-permissions.js';
import { ensurePeerAgent, resolveOrCreateThread } from '../a2a/inbound-thread.js';
import { verifyA2ASignature } from '../a2a/verify-signature.js';
import { getDb } from '../db/connection.js';
import { agents, messages, peerContacts, users } from '../db/schema.js';
import { decideAdmission, isSenderAuthorized } from '../lib/a2a-admission.js';
import { isContact } from '../lib/tenant.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { broadcastToConversation } from '../ws/handler.js';

// The two inbound A2A endpoints. Everything they call lives under `a2a/`:
// signature verification, the peer/thread resolution the message is filed
// against, the two approval gates, and the agent turn that answers it. This
// file is the HTTP shape and the order the gates run in — gather, decide, act —
// and the 900 lines it used to be made that order impossible to see.

export const a2aRoutes = new Hono();

a2aRoutes.use('/*', rateLimit(60, 60_000));

const a2aMessageSchema = z.object({
  from: z.string().startsWith('did:'),
  to: z.string().startsWith('did:'),
  // Bounded because it is peer-supplied and travels with the message. It is
  // never written to a column — see `thread_root` below.
  thread_id: z.string().max(128).optional(),
  message: z.object({
    type: z.enum(['question', 'answer', 'notification']),
    content: z.string(),
    language: z.string().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  }),
});

/**
 * The local agent a message is addressed to, by either DID that names it.
 *
 * Two identifiers reach us for the same agent and both are legitimate. Public
 * discovery (`/.well-known/agents.json`) lists the AGENT did — `<user>:agent` —
 * and that is what a domain lookup records. But the only document anyone can
 * *resolve* is the OWNER's, published at `/agents/<username>/did.json`, and it
 * is the identifier the app shows its user behind a copy button. A peer holding
 * that DID is doing exactly the right thing.
 *
 * Matching only the agent DID meant every contact added from a pasted DID was
 * unreachable: the transport connected, the signature verified, and delivery
 * then failed with "Target agent not found".
 */
async function findTargetAgent(to: string) {
  const db = getDb();
  const [byAgentDid] = await db.select().from(agents).where(eq(agents.did, to)).limit(1);
  if (byAgentDid) return byAgentDid;

  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.did, to)).limit(1);
  if (!owner) return undefined;

  const [byOwner] = await db.select().from(agents).where(eq(agents.user_id, owner.id)).limit(1);
  return byOwner;
}

a2aRoutes.post('/messages', verifyA2ASignature, async (c) => {
  const body = a2aMessageSchema.parse(await c.req.json());
  const db = getDb();

  // `from` must be the signing key's DID or a sub-identifier under it (e.g.
  // did:web:vendor.com signing for did:web:vendor.com:users:li). Otherwise a
  // peer with one valid key could forge connection requests under any identity.
  const signerDid = c.get('a2aSenderDid' as never) as string | undefined;
  if (!isSenderAuthorized(signerDid, body.from)) {
    throw new AppError(
      'sender_mismatch',
      'Message `from` is not authorized by the signing key',
      401,
    );
  }

  const targetAgent = await findTargetAgent(body.to);

  // A suspended agent is treated as absent: moderation takes it off the air for
  // inbound A2A too, not just public discovery. Don't reveal the suspension.
  if (!targetAgent || targetAgent.status === 'suspended') {
    throw new AppError('not_found', 'Target agent not found on this instance', 404);
  }

  const peer = await ensurePeerAgent(targetAgent.user_id, body.from, signerDid);

  if (!peer) {
    throw new AppError('peer_unavailable', 'Failed to resolve peer agent', 500);
  }

  // A message from an unconnected peer is held as a pending connection request
  // until the owner approves it in the permission inbox.
  const connected = await isContact(targetAgent.user_id, peer.id);

  if (!connected) {
    await upsertConnectionRequest(targetAgent.user_id, peer, body.message.content);
    return c.json(
      {
        status: 'pending_connection',
        message: 'Connection request is awaiting approval from the recipient',
      },
      202,
    );
  }

  const [contact] = await db
    .select({ overrides: peerContacts.policy_overrides_json })
    .from(peerContacts)
    .where(and(eq(peerContacts.user_id, targetAgent.user_id), eq(peerContacts.peer_id, peer.id)))
    .limit(1);
  const admission = decideAdmission({
    peerDid: body.from,
    agentPolicies: parsePolicyConfig(targetAgent.policies_json),
    contactOverrides: contact?.overrides,
  });

  if (admission === 'deny') {
    throw new AppError('policy_denied', 'Agent policy denied this request', 403);
  }

  // Shared for both `allow` and `ask_user`: the owner sees the inbound message
  // in their IM either way. Only the auto-reply differs (immediate vs. held).
  const convId = await resolveOrCreateThread(body.thread_id, peer.id, targetAgent.user_id);

  const msgId = newId();
  await db.insert(messages).values({
    id: msgId,
    conversation_id: convId,
    sender_type: 'peer_agent',
    sender_id: peer.id,
    sender_did: body.from,
    content_type: 'text',
    content: body.message.content,
    language: body.message.language,
    // The LOCAL thread. `thread_root` is char(26) and indexed for our own
    // conversation ids; storing the peer's raw thread_id put a foreign — and
    // unvalidated — string there. It named a conversation we may not own
    // (resolveOrCreateThread rejects a thread that isn't ours and makes a new
    // one), and anything longer than 26 characters failed the insert outright,
    // so a peer could 500 this endpoint with a thread id of its choosing.
    thread_root: convId,
    via: 'a2a',
    delivered_at: new Date(),
  });

  // Broadcast the inbound message so web subscribers and consult long-polls
  // wake up regardless of message type.
  broadcastToConversation(convId, {
    type: 'message.new',
    data: {
      id: msgId,
      conversation_id: convId,
      sender_type: 'peer_agent',
      sender_id: peer.id,
      content: body.message.content,
      in_reply_to: body.thread_id,
    },
  });

  // `hold`: keep an inbound question for owner review instead of answering
  // automatically. The message is already stored + broadcast above; we record a
  // pending `ask` permission and return without spawning the agent loop. Only a
  // question can be held — an answer/notification never auto-replies anyway, so
  // there is nothing to gate.
  if (admission === 'hold' && body.message.type === 'question') {
    await holdA2AQuestion({
      userId: targetAgent.user_id,
      agentId: targetAgent.id,
      peer,
      senderDid: body.from,
      conversationId: convId,
      peerThreadId: body.thread_id,
      inboundMessageId: msgId,
      content: body.message.content,
    });
    return c.json({ status: 'pending_approval', message_id: msgId }, 202);
  }

  // Only an inbound question triggers our local auto-reply loop. An answer or
  // notification (e.g. a peer responding to one of our outgoing consults) is
  // stored and broadcast above but must NOT spawn another reply — otherwise two
  // agents would ping-pong forever. A held question returned above, so a
  // question reaching here is one the policy admitted.
  if (body.message.type === 'question') {
    setImmediate(async () => {
      try {
        await processA2AMessage({
          targetAgent,
          senderDid: body.from,
          senderPeer: peer,
          messageContent: body.message.content,
          conversationId: convId,
          peerThreadId: body.thread_id,
          inboundMessageId: msgId,
        });
      } catch (error) {
        console.error('A2A processing failed:', error);
      }
    });
  }

  return c.json(
    {
      message_id: msgId,
      thread_id: body.thread_id ?? convId,
      stream_url: `/a2a/v1/stream/${msgId}`,
    },
    201,
  );
});

a2aRoutes.get('/stream/:messageId', verifyA2ASignature, async (c) => {
  const messageId = c.req.param('messageId');
  const db = getDb();

  const [inbound] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);

  if (!inbound) {
    throw new AppError('not_found', 'Message not found', 404);
  }

  // Only the peer that originally sent the message may poll for its reply —
  // the signature proves who the caller is, but not that the message is theirs.
  const callerDid = c.get('a2aSenderDid' as never) as string | undefined;
  if (inbound.sender_did !== callerDid) {
    throw new AppError('forbidden', 'Not authorized to read this message', 403);
  }

  const [reply] = await db
    .select()
    .from(messages)
    .where(eq(messages.in_reply_to, messageId))
    .limit(1);

  return streamSSE(c, async (stream) => {
    if (reply) {
      await stream.writeSSE({
        event: 'message',
        data: JSON.stringify({ message_id: reply.id, content: reply.content, status: 'done' }),
      });
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ message_id: reply.id, status: 'done' }),
      });
    } else {
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ message_id: messageId, status: 'pending' }),
      });
    }
  });
});
