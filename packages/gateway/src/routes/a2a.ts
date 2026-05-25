import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import * as jose from 'jose';
import { AppError, newId } from '@confer/shared';
import {
  verifyRequestSignature,
  parseSignatureHeader,
  resolveDID,
  multibaseToPublicKey,
} from '@confer/identity';
import {
  getProvider,
  runAgentLoop,
  evaluatePolicy,
  classifyPermissionLevel,
  parsePolicyConfig,
} from '@confer/agent-runtime';
import type { AgentContext } from '@confer/agent-runtime';
import { getDb } from '../db/connection.js';
import {
  messages,
  conversations,
  peerAgents,
  conversationParticipants,
  agents,
  permissions,
  keypairs,
} from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { rateLimit } from '../middleware/rate-limit.js';
import { broadcastToConversation } from '../ws/handler.js';
import { sendA2AMessage } from '../a2a/outbound.js';

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

const verifyCapabilityToken: MiddlewareHandler = async (c, next) => {
  const capHeader = c.req.header('authorization');
  if (!capHeader || !capHeader.startsWith('Capability ')) {
    await next();
    return;
  }

  const token = capHeader.slice('Capability '.length);
  try {
    const decoded = jose.decodeJwt(token);

    if (decoded.exp !== undefined && decoded.exp < Math.floor(Date.now() / 1000)) {
      throw new AppError('capability_invalid', 'Capability token has expired', 401);
    }

    const delegationDepth = decoded['delegation_depth'];
    if (typeof delegationDepth === 'number' && delegationDepth > 3) {
      throw new AppError('capability_invalid', 'Delegation depth exceeds maximum of 3', 401);
    }

    c.set('capability' as never, decoded as never);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('capability_invalid', 'Invalid capability token', 401);
  }

  await next();
};

a2aRoutes.post('/messages', verifyA2ASignature, verifyCapabilityToken, async (c) => {
  const body = a2aMessageSchema.parse(await c.req.json());
  const db = getDb();

  const [targetAgent] = await db
    .select()
    .from(agents)
    .where(eq(agents.did, body.to))
    .limit(1);

  if (!targetAgent) {
    throw new AppError('not_found', 'Target agent not found on this instance', 404);
  }

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

  const level = classifyPermissionLevel('ask');
  const policyRequest = {
    action: 'ask',
    peer_did: body.from,
    level,
  };

  const policyConfig = parsePolicyConfig(targetAgent.policies_json);
  const decision = evaluatePolicy(policyRequest, policyConfig);

  if (decision === 'deny') {
    throw new AppError('policy_denied', 'Agent policy denied this request', 403);
  }

  if (decision === 'ask_user') {
    await db.insert(permissions).values({
      id: newId(),
      user_id: targetAgent.user_id,
      peer_id: peer!.id,
      action: 'ask',
      scope_json: { message_type: body.message.type },
      level,
      decision: 'pending',
      requested_by: peer!.id,
    });
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
      created_by: targetAgent.user_id,
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

  const resolvedPeer = peer!;
  const resolvedConvId = convId;

  setImmediate(async () => {
    try {
      await processA2AMessage({
        targetAgent,
        senderDid: body.from,
        senderPeer: resolvedPeer,
        messageContent: body.message.content,
        conversationId: resolvedConvId,
        inboundMessageId: msgId,
      });
    } catch (error) {
      console.error('A2A processing failed:', error);
    }
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
  const db = getDb();

  const [inbound] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);

  if (!inbound) {
    throw new AppError('not_found', 'Message not found', 404);
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

interface ProcessA2AMessageParams {
  targetAgent: typeof agents.$inferSelect;
  senderDid: string;
  senderPeer: typeof peerAgents.$inferSelect;
  messageContent: string;
  conversationId: string;
  inboundMessageId: string;
}

async function processA2AMessage(params: ProcessA2AMessageParams): Promise<void> {
  const {
    targetAgent,
    senderDid,
    senderPeer,
    messageContent,
    conversationId,
    inboundMessageId,
  } = params;

  const modelConfig = targetAgent.model_config_json as Record<string, unknown> | null;
  const providerName = (modelConfig?.provider as string) ?? 'anthropic';
  const provider = getProvider(providerName);

  if (!provider) {
    console.error(`No LLM provider configured for agent ${targetAgent.id} (provider: ${providerName})`);
    return;
  }

  const agentCtx: AgentContext = {
    agentId: targetAgent.id,
    userId: targetAgent.user_id,
    provider,
    systemPrompt: targetAgent.description ?? 'You are a helpful AI agent.',
    conversationHistory: [],
  };

  const replyContent = await runAgentLoop(agentCtx, messageContent);

  const db = getDb();
  const replyId = newId();

  await db.insert(messages).values({
    id: replyId,
    conversation_id: conversationId,
    sender_type: 'own_agent',
    sender_id: targetAgent.id,
    sender_did: targetAgent.did,
    content_type: 'text',
    content: replyContent,
    in_reply_to: inboundMessageId,
    via: 'a2a',
    delivered_at: new Date(),
  });

  broadcastToConversation(conversationId, {
    type: 'message.new',
    data: {
      id: replyId,
      conversation_id: conversationId,
      sender_type: 'own_agent',
      sender_id: targetAgent.id,
      content: replyContent,
      in_reply_to: inboundMessageId,
    },
  });

  const peerEndpoint = senderPeer.endpoint;

  if (!peerEndpoint) {
    console.error(`No endpoint known for peer ${senderDid}, skipping outbound reply`);
    return;
  }

  const [keypair] = await db
    .select()
    .from(keypairs)
    .where(
      and(
        eq(keypairs.owner_type, 'agent'),
        eq(keypairs.owner_id, targetAgent.id),
        eq(keypairs.is_active, true),
      ),
    )
    .limit(1);

  if (!keypair) {
    console.error(`No active signing keypair for agent ${targetAgent.id}`);
    return;
  }

  const privateKeyJwk = JSON.stringify(keypair.private_key_jwk_encrypted);

  const outboundResult = await sendA2AMessage(
    peerEndpoint,
    {
      from: targetAgent.did,
      to: senderDid,
      thread_id: conversationId,
      message: {
        type: 'answer',
        content: replyContent,
      },
    },
    keypair.key_id,
    privateKeyJwk,
  );

  if (!outboundResult.ok) {
    console.error(`Failed to send A2A reply to ${senderDid}: ${outboundResult.error}`);
  }
}
