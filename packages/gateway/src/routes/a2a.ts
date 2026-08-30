import { AppError } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { admitInboundMessage } from '../a2a/inbound.js';
import { findAgentByDid, isReachable } from '../a2a/target-agent.js';
import { verifyA2ASignature } from '../a2a/verify-signature.js';
import { getDb } from '../db/connection.js';
import { messages } from '../db/schema.js';
import { isSenderAuthorized } from '../lib/a2a-admission.js';

// Confer's own A2A dialect. The spec-conformant HTTP+JSON binding lives beside
// it in `a2a-rest.ts` and shares every gate through `a2a/inbound.ts`; this file
// is just the wire shape Confer instances speak to each other.
//
// It is deliberately NOT advertised in the Agent Card: the spec requires all
// bindings an agent declares to be functionally equivalent (§5.1), and this one
// has no task lifecycle. Confer peers find it through `/.well-known/agents.json`
// instead, which is Confer's own directory.

export const a2aRoutes = new Hono();

const a2aMessageSchema = z.object({
  from: z.string().startsWith('did:'),
  to: z.string().startsWith('did:'),
  // Bounded because it is peer-supplied and travels with the message. It is
  // never written to a column — see `thread_root` in `a2a/inbound.ts`.
  thread_id: z.string().max(128).optional(),
  message: z.object({
    type: z.enum(['question', 'answer', 'notification']),
    content: z.string(),
    language: z.string().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  }),
});

a2aRoutes.post('/messages', verifyA2ASignature, async (c) => {
  const body = a2aMessageSchema.parse(await c.req.json());

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

  const targetAgent = await findAgentByDid(body.to);
  if (!isReachable(targetAgent)) {
    throw new AppError('not_found', 'Target agent not found on this instance', 404);
  }

  const admitted = await admitInboundMessage({
    targetAgent,
    senderDid: body.from,
    signerDid,
    threadId: body.thread_id,
    message: body.message,
  });

  switch (admitted.status) {
    case 'pending_connection':
      return c.json(
        {
          status: 'pending_connection',
          message: 'Connection request is awaiting approval from the recipient',
        },
        202,
      );
    case 'denied':
      throw new AppError('policy_denied', 'Agent policy denied this request', 403);
    case 'held':
      return c.json({ status: 'pending_approval', message_id: admitted.messageId }, 202);
    default:
      return c.json(
        {
          message_id: admitted.messageId,
          thread_id: body.thread_id ?? admitted.conversationId,
          stream_url: `/a2a/v1/stream/${admitted.messageId}`,
        },
        201,
      );
  }
});

a2aRoutes.get('/stream/:messageId', verifyA2ASignature, async (c) => {
  const messageId = c.req.param('messageId');
  const db = getDb();

  const [inbound] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);

  // Only the peer that originally sent the message may poll for its reply — the
  // signature proves who the caller is, but not that the message is theirs. A
  // message belonging to someone else reads as absent rather than forbidden, so
  // this cannot be used to probe which message ids exist.
  const callerDid = c.get('a2aSenderDid' as never) as string | undefined;
  if (!inbound || inbound.sender_did !== callerDid) {
    throw new AppError('not_found', 'Message not found', 404);
  }

  const [reply] = await db
    .select()
    .from(messages)
    .where(eq(messages.in_reply_to, messageId))
    .limit(1);

  // A turn that could not run writes a `system_notice` in reply rather than an
  // answer. It has to be reported as `failed`, not `done`: handing back the
  // reason for the failure as though it were the agent's answer is the same
  // silence this endpoint used to produce, just harder to notice.
  const failed = reply?.content_type === 'system_notice';
  const errorCode =
    failed && reply?.content_json && typeof reply.content_json === 'object'
      ? ((reply.content_json as { error?: unknown }).error ?? null)
      : null;

  return streamSSE(c, async (stream) => {
    if (reply) {
      await stream.writeSSE({
        event: 'message',
        data: JSON.stringify({
          message_id: reply.id,
          content: reply.content,
          status: failed ? 'failed' : 'done',
          ...(errorCode ? { error: errorCode } : {}),
        }),
      });
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({
          message_id: reply.id,
          status: failed ? 'failed' : 'done',
          ...(errorCode ? { error: errorCode } : {}),
        }),
      });
    } else {
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ message_id: messageId, status: 'pending' }),
      });
    }
  });
});
