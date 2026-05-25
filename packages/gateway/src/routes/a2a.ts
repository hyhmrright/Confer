import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { AppError, newId } from '@confer/shared';
import {
  verifyRequestSignature,
  parseSignatureHeader,
  resolveDID,
  multibaseToPublicKey,
} from '@confer/identity';
import { getDb } from '../db/connection.js';
import { messages, conversations, peerAgents, conversationParticipants } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { rateLimit } from '../middleware/rate-limit.js';

const a2aMessageSchema = z.object({
  from: z.string().startsWith('did:'),
  to: z.string().startsWith('did:'),
  thread_id: z.string().optional(),
  message: z.object({
    type: z.enum(['question', 'answer', 'notification']),
    content: z.string(),
    language: z.string().optional(),
    context: z.record(z.unknown()).optional(),
  }),
});

export const a2aRoutes = new Hono();

a2aRoutes.use('/*', rateLimit(60, 60_000));

const verifyA2ASignature: MiddlewareHandler = async (c, next) => {
  const sigHeader = c.req.header('signature');
  if (!sigHeader) {
    throw new AppError('signature_missing', 'Signature header is required', 401);
  }

  const parsed = parseSignatureHeader(sigHeader);
  if (!parsed.ok) {
    throw new AppError('signature_invalid', parsed.error, 401);
  }

  const keyId = parsed.value.keyId;
  const didMatch = keyId.match(/^(did:web:[^#]+)/);
  if (!didMatch) {
    throw new AppError('signature_invalid', 'Invalid keyId format in signature', 401);
  }

  const senderDid = didMatch[1]!;
  const didResult = await resolveDID(senderDid);
  if (!didResult.ok) {
    throw new AppError('did_resolution_failed', didResult.error, 401);
  }

  const didDoc = didResult.value;
  const vm = didDoc.verificationMethod.find((m) => m.id === keyId);
  if (!vm) {
    throw new AppError('key_not_found', `Key ${keyId} not found in DID document`, 401);
  }

  const keyResult = await multibaseToPublicKey(vm.publicKeyMultibase);
  if (!keyResult.ok) {
    throw new AppError('key_invalid', keyResult.error, 401);
  }

  const verifyResult = await verifyRequestSignature(c.req.raw, keyResult.value);
  if (!verifyResult.ok) {
    throw new AppError('signature_failed', verifyResult.error, 401);
  }

  await next();
};

a2aRoutes.post('/messages', verifyA2ASignature, async (c) => {
  const body = a2aMessageSchema.parse(await c.req.json());
  const db = getDb();

  let [peer] = await db
    .select()
    .from(peerAgents)
    .where(eq(peerAgents.did, body.from))
    .limit(1);

  if (!peer) {
    const peerId = newId();
    [peer] = await db
      .insert(peerAgents)
      .values({
        id: peerId,
        did: body.from,
        endpoint: '',
        public_key_json: {},
        agent_facts_json: {},
      })
      .returning();
  }

  let convId = body.thread_id;

  if (convId) {
    const [existing] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, convId))
      .limit(1);
    if (!existing) convId = undefined;
  }

  if (!convId) {
    convId = newId();
    await db.insert(conversations).values({
      id: convId,
      type: 'direct_agent_agent',
      created_by: peer!.id,
    });

    await db.insert(conversationParticipants).values({
      id: newId(),
      conversation_id: convId,
      participant_type: 'peer_agent',
      peer_id: peer!.id,
      role: 'member',
    });
  }

  const msgId = newId();
  await db.insert(messages).values({
    id: msgId,
    conversation_id: convId,
    sender_type: 'peer_agent',
    sender_id: peer!.id,
    sender_did: body.from,
    content_type: 'text',
    content: body.message.content,
    language: body.message.language,
    thread_root: body.thread_id,
    via: 'a2a',
    delivered_at: new Date(),
  });

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

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      event: 'done',
      data: JSON.stringify({ message_id: messageId, status: 'pending' }),
    });
  });
});
