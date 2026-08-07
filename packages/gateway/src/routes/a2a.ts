import type { LLMMessage } from '@confer/agent-runtime';
import { classifyPermissionLevel, createProvider, parsePolicyConfig } from '@confer/agent-runtime';
import {
  MAX_CLOCK_SKEW_MS,
  multibaseToPublicKey,
  parseSignatureInput,
  resolveDID,
  verifyRequestSignature,
} from '@confer/identity';
import { AppError, newId } from '@confer/shared';
import { and, asc, eq, lt } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { sendA2AMessage } from '../a2a/outbound.js';
import { loadActiveAgentKey } from '../a2a/signing.js';
import { getDb } from '../db/connection.js';
import {
  agents,
  conversationParticipants,
  conversations,
  messages,
  peerAgents,
  peerContacts,
  permissions,
} from '../db/schema.js';
import { getEnv } from '../env.js';
import { decideAdmission, isSenderAuthorized } from '../lib/a2a-admission.js';
import { decryptUserKey, getUserLlmKeys, resolveAgentCapabilities } from '../lib/llm-keys.js';
import { addNonce, hasNonce } from '../lib/nonce-cache.js';
import { upsertPeerAgent } from '../lib/peer-agent.js';
import { isContact } from '../lib/tenant.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { runAgentTurn } from '../orchestration/agent-orchestrator.js';
import { extractAndStore } from '../tools/memory.js';
import { broadcastToConversation } from '../ws/handler.js';
import { notifyPermissionRequest } from './permission-notify.js';

const a2aMessageSchema = z.object({
  from: z.string().startsWith('did:'),
  to: z.string().startsWith('did:'),
  thread_id: z.string().optional(),
  message: z.object({
    type: z.enum(['question', 'answer', 'notification']),
    content: z.string(),
    language: z.string().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  }),
});

// Resolve a peer's A2A service endpoint from its DID document. Returns '' if
// the DID cannot be resolved or advertises no service endpoint.
async function resolvePeerEndpoint(did: string): Promise<string> {
  const result = await resolveDID(did);
  if (!result.ok) return '';
  return result.value.service?.find((s) => s.serviceEndpoint)?.serviceEndpoint ?? '';
}

// Store a pending permission raised by an inbound peer and push it to the
// owner's inbox. Both A2A gates (connect, ask) land here, so the row shape and
// the notification can never drift apart: `requested_by` is always the peer,
// and the pushed event always carries the same `created_at` that was written.
async function requestPeerPermission(request: {
  userId: string;
  peer: typeof peerAgents.$inferSelect;
  action: 'connect' | 'ask';
  level: string;
  // Stored verbatim as JSONB and interpreted per-action by the inbox card, so
  // any object shape is valid here.
  scope: object;
}): Promise<void> {
  const id = newId();
  const [inserted] = await getDb()
    .insert(permissions)
    .values({
      id,
      user_id: request.userId,
      peer_id: request.peer.id,
      action: request.action,
      scope_json: request.scope,
      level: request.level,
      decision: 'pending',
      requested_by: request.peer.id,
    })
    .returning({ created_at: permissions.created_at });

  notifyPermissionRequest(request.userId, {
    id,
    level: request.level,
    action: request.action,
    scope_json: request.scope,
    peer_name: request.peer.name,
    peer_did: request.peer.did,
    created_at: inserted?.created_at ?? new Date(),
  });
}

// Record a pending connection request from an unconnected peer, deduplicated
// so repeated messages from the same peer don't flood the owner's inbox.
async function upsertConnectionRequest(
  userId: string,
  peer: typeof peerAgents.$inferSelect,
  firstMessage: string,
): Promise<void> {
  const [existing] = await getDb()
    .select()
    .from(permissions)
    .where(
      and(
        eq(permissions.user_id, userId),
        eq(permissions.peer_id, peer.id),
        eq(permissions.action, 'connect'),
        eq(permissions.decision, 'pending'),
      ),
    )
    .limit(1);

  // Only a genuinely new request gets past here, so the owner is never
  // double-notified for a peer that keeps retrying.
  if (existing) return;

  await requestPeerPermission({
    userId,
    peer,
    action: 'connect',
    level: 'L2',
    scope: {
      peer_did: peer.did,
      peer_name: peer.name,
      first_message: firstMessage.slice(0, 500),
    },
  });
}

// Scope payload stored on a held `ask` permission. Carries exactly what
// `resumeHeldA2AQuestion` needs to rebuild the agent-loop call after approval;
// `targetAgent`/`senderPeer` are re-read from the DB at resume time (by
// user_id/peer_id) so an approval never replays a stale snapshot.
export interface A2AQuestionScope {
  kind: 'a2a_question';
  conversation_id: string;
  inbound_message_id: string;
  sender_did: string;
  // The specific agent the question was addressed to (a user may own several),
  // so the resume re-reads the right agent rather than an arbitrary one.
  agent_id: string;
  content: string;
}

interface HoldA2AQuestionParams {
  userId: string;
  agentId: string;
  peer: typeof peerAgents.$inferSelect;
  senderDid: string;
  conversationId: string;
  inboundMessageId: string;
  content: string;
}

// Record an inbound question from a connected peer as a pending `ask`
// permission for the owner to approve before the agent answers. The inbound
// message is already stored and broadcast by the caller; this only adds the
// approval gate.
function holdA2AQuestion(params: HoldA2AQuestionParams): Promise<void> {
  const scope: A2AQuestionScope = {
    kind: 'a2a_question',
    conversation_id: params.conversationId,
    inbound_message_id: params.inboundMessageId,
    sender_did: params.senderDid,
    agent_id: params.agentId,
    content: params.content.slice(0, 500),
  };

  return requestPeerPermission({
    userId: params.userId,
    peer: params.peer,
    action: 'ask',
    level: classifyPermissionLevel('ask'),
    scope,
  });
}

// Look up the sending peer by DID, creating it on first contact. The endpoint
// is resolved from the sender's DID document up front so a reply can be sent
// once the owner approves the connection. Returns null if the peer can't be
// persisted.
async function ensurePeerAgent(fromDid: string): Promise<typeof peerAgents.$inferSelect | null> {
  const db = getDb();
  const [existing] = await db.select().from(peerAgents).where(eq(peerAgents.did, fromDid)).limit(1);
  if (existing) return existing;

  const created = await upsertPeerAgent({
    did: fromDid,
    endpoint: await resolvePeerEndpoint(fromDid),
  });
  return created ?? null;
}

// Resolve the conversation for this inbound message: reuse the supplied
// thread_id only if the peer is already a participant of it AND the thread
// belongs to the addressed agent's owner, else create a fresh agent-to-agent
// conversation seeded with both the owner and the peer as participants.
//
// Both halves of that check matter. Peer rows are global (keyed by DID), so a
// peer connected to two owners passes a peer-only participant check on either
// owner's thread — it could then steer a message addressed to one owner's agent
// into the other owner's conversation, where the reply would be broadcast to
// the wrong owner and that owner's history would feed the wrong agent's context.
async function resolveOrCreateThread(
  threadId: string | undefined,
  peerId: string,
  userId: string,
): Promise<string> {
  const db = getDb();
  let convId = threadId;

  if (convId) {
    const [member] = await db
      .select({ id: conversationParticipants.id })
      .from(conversationParticipants)
      .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversation_id))
      .where(
        and(
          eq(conversationParticipants.conversation_id, convId),
          eq(conversationParticipants.peer_id, peerId),
          eq(conversations.created_by, userId),
        ),
      )
      .limit(1);
    if (!member) convId = undefined;
  }

  if (!convId) {
    convId = newId();
    await db.insert(conversations).values({
      id: convId,
      type: 'direct_agent_agent',
      created_by: userId,
    });

    // The owner is seeded as a participant alongside the peer: the conversation
    // list and the per-conversation read gates are both keyed on a participant
    // row, so without it the owner cannot see the thread their own agent is
    // answering in.
    await db.insert(conversationParticipants).values([
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
  }

  return convId;
}

export const a2aRoutes = new Hono();

a2aRoutes.use('/*', rateLimit(60, 60_000));

const verifyA2ASignature: MiddlewareHandler = async (c, next) => {
  const sigInputHeader = c.req.header('signature-input');
  if (!sigInputHeader) {
    throw new AppError('signature_missing', 'Signature-Input header is required', 401);
  }

  const parsed = parseSignatureInput(sigInputHeader);
  if (!parsed.ok) {
    throw new AppError('signature_invalid', parsed.error, 401);
  }

  const keyId = parsed.value.keyid;
  const didMatch = keyId.match(/^(did:web:[^#]+)/);
  const senderDid = didMatch?.[1];
  if (!senderDid) {
    throw new AppError('signature_invalid', 'Invalid keyId format in signature', 401);
  }

  const didResult = await resolveDID(senderDid);
  if (!didResult.ok) {
    throw new AppError('did_resolution_failed', didResult.error, 401);
  }

  const didDoc = didResult.value;
  const vm = didDoc.verificationMethod.find((m) => m.id === keyId);
  if (!vm) {
    throw new AppError('key_not_found', `Key ${keyId} not found in DID document`, 401);
  }

  // Finding E: registration in `verificationMethod` is not authorization to sign
  // for authentication. When the document declares an `authentication`
  // relationship, the key must be listed there. Documents that predate this
  // field (no `authentication` array) keep the legacy behavior — a registered
  // key is accepted — so minimal third-party docs and our own aren't broken.
  if (didDoc.authentication && !authenticationAllows(didDoc.authentication, keyId)) {
    throw new AppError(
      'key_not_authorized',
      `Key ${keyId} is not authorized for authentication`,
      401,
    );
  }

  const keyResult = await multibaseToPublicKey(vm.publicKeyMultibase);
  if (!keyResult.ok) {
    throw new AppError('key_invalid', keyResult.error, 401);
  }

  const verifyResult = await verifyRequestSignature(c.req.raw, keyResult.value);
  if (!verifyResult.ok) {
    throw new AppError('signature_failed', verifyResult.error, 401);
  }

  // Finding C: reject a byte-identical replay of an already-verified signature
  // within the clock-skew window. Ed25519 is deterministic and Finding B binds
  // the signature to method+authority+path+date+content-digest, so the Signature
  // header value uniquely identifies this request. Checked only AFTER
  // cryptographic verification so forged/invalid signatures never consume cache
  // space, and recorded with TTL = the skew window since anything older is
  // already rejected by the skew check.
  const nonceKey = `${keyId}:${c.req.header('signature')}`;
  if (hasNonce(nonceKey)) {
    throw new AppError('signature_replayed', 'This signed request has already been processed', 401);
  }
  addNonce(nonceKey, MAX_CLOCK_SKEW_MS);

  // Expose the cryptographically proven signer DID so the handler can ensure
  // the message `from` isn't forged under another identity.
  c.set('a2aSenderDid' as never, senderDid as never);

  await next();
};

// A DID `authentication` entry is either a bare string reference to a
// verification method id or an embedded verification-method object; the key is
// authorized if it matches either form.
function authenticationAllows(
  authentication: ReadonlyArray<string | { id: string }>,
  keyId: string,
): boolean {
  return authentication.some((entry) =>
    typeof entry === 'string' ? entry === keyId : entry.id === keyId,
  );
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

  const [targetAgent] = await db.select().from(agents).where(eq(agents.did, body.to)).limit(1);

  // A suspended agent is treated as absent: moderation takes it off the air for
  // inbound A2A too, not just public discovery. Don't reveal the suspension.
  if (!targetAgent || targetAgent.status === 'suspended') {
    throw new AppError('not_found', 'Target agent not found on this instance', 404);
  }

  const peer = await ensurePeerAgent(body.from);

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
    thread_root: body.thread_id,
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
  if (admission === 'hold') {
    if (body.message.type === 'question') {
      await holdA2AQuestion({
        userId: targetAgent.user_id,
        agentId: targetAgent.id,
        peer,
        senderDid: body.from,
        conversationId: convId,
        inboundMessageId: msgId,
        content: body.message.content,
      });
      return c.json({ status: 'pending_approval', message_id: msgId }, 202);
    }
    return c.json(
      {
        message_id: msgId,
        thread_id: body.thread_id ?? convId,
        stream_url: `/a2a/v1/stream/${msgId}`,
      },
      201,
    );
  }

  // `allow`: only an inbound question triggers our local auto-reply loop. An
  // answer or notification (e.g. a peer responding to one of our outgoing
  // consults) is stored and broadcast above but must NOT spawn another reply —
  // otherwise two agents would ping-pong forever.
  if (body.message.type === 'question') {
    setImmediate(async () => {
      try {
        await processA2AMessage({
          targetAgent,
          senderDid: body.from,
          senderPeer: peer,
          messageContent: body.message.content,
          conversationId: convId,
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

interface ProcessA2AMessageParams {
  targetAgent: typeof agents.$inferSelect;
  senderDid: string;
  senderPeer: typeof peerAgents.$inferSelect;
  messageContent: string;
  conversationId: string;
  inboundMessageId: string;
}

// Load up to 20 prior visible messages of an A2A thread as LLM history,
// excluding the current inbound message. The peer asking is the `user`; this
// agent's own prior replies are `assistant`, mirroring the chat path's role
// mapping. Moderator-hidden messages are excluded from the LLM context.
async function loadA2AHistory(
  conversationId: string,
  inboundMessageId: string,
): Promise<LLMMessage[]> {
  const rows = await getDb()
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversation_id, conversationId),
        lt(messages.id, inboundMessageId),
        eq(messages.moderation_status, 'visible'),
      ),
    )
    .orderBy(asc(messages.created_at))
    .limit(20);

  return rows.map((m) => ({
    role: m.sender_type === 'peer_agent' ? 'user' : 'assistant',
    content: m.content ?? '',
  }));
}

async function processA2AMessage(params: ProcessA2AMessageParams): Promise<void> {
  const { targetAgent, senderDid, senderPeer, messageContent, conversationId, inboundMessageId } =
    params;

  const modelConfig = targetAgent.model_config_json as Record<string, unknown> | null;
  const providerName = (modelConfig?.provider as string) ?? 'anthropic';

  const db = getDb();
  const env = getEnv();
  const llmKeys = await getUserLlmKeys(targetAgent.user_id);
  const apiKey = await decryptUserKey(llmKeys, providerName, env.ENCRYPTION_KEY);

  const provider = createProvider(providerName, apiKey);
  if (!provider) {
    console.error(
      `No LLM provider configured for agent ${targetAgent.id} (provider: ${providerName})`,
    );
    return;
  }

  // Tools, recall, and extraction all spend the budget of the agent's owner —
  // never the requesting peer's.
  const { embeddingKey, embeddingProvider, tavilyApiKey, hasKb } = await resolveAgentCapabilities(
    targetAgent.user_id,
    llmKeys,
    env,
  );

  const history = await loadA2AHistory(conversationId, inboundMessageId);

  const { content: replyContent, citations } = await runAgentTurn({
    provider,
    systemPromptBase: targetAgent.description ?? 'You are a helpful AI agent.',
    history,
    userMessage: messageContent,
    userId: targetAgent.user_id,
    embeddingKey,
    embeddingProvider,
    tavilyApiKey,
    hasKb,
  });

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
    citations_json: citations.length > 0 ? citations : undefined,
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

  // Fire-and-forget: distil durable facts from this A2A turn into long-term
  // memory, mirroring the chat path. Runs before the outbound delivery block so
  // an unsendable reply (no peer endpoint / unsignable) still feeds memory.
  // Best-effort: log userId only on failure, never the message content (PII).
  if (embeddingKey && replyContent) {
    const recentTurns = `peer：${messageContent}\n本agent：${replyContent}`;
    void extractAndStore({
      userId: targetAgent.user_id,
      provider,
      embeddingKey,
      embeddingProvider,
      recentTurns,
    }).catch((err) => {
      console.error(`Memory extraction failed for user ${targetAgent.user_id}:`, err);
    });
  }

  const peerEndpoint = senderPeer.endpoint;

  if (!peerEndpoint) {
    console.error(`No endpoint known for peer ${senderDid}, skipping outbound reply`);
    return;
  }

  const key = await loadActiveAgentKey(targetAgent.id);
  if (!key.ok) {
    console.error(`Cannot sign A2A reply for agent ${targetAgent.id}: ${key.error}`);
    return;
  }

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
    key.value.keyId,
    key.value.privateKeyJwk,
  );

  if (!outboundResult.ok) {
    console.error(`Failed to send A2A reply to ${senderDid}: ${outboundResult.error}`);
  }
}

// Narrow a permission's scope_json to the held-question shape, or null if it's
// not an a2a_question scope (e.g. a connect request scope).
function asA2AQuestionScope(scope: unknown): A2AQuestionScope | null {
  if (!scope || typeof scope !== 'object') return null;
  const s = scope as Record<string, unknown>;
  if (
    s.kind !== 'a2a_question' ||
    typeof s.conversation_id !== 'string' ||
    typeof s.inbound_message_id !== 'string' ||
    typeof s.sender_did !== 'string' ||
    typeof s.agent_id !== 'string'
  ) {
    return null;
  }
  return s as unknown as A2AQuestionScope;
}

// Resume a held A2A question after the owner approves it. Re-reads the target
// agent (by user_id) and sending peer (by peer_id) from the DB so no stale
// snapshot is replayed, then runs the same agent loop the `allow` path would
// have. Idempotent: if a reply to the inbound message already exists (e.g. a
// double approval), it returns without producing a second answer.
export async function resumeHeldA2AQuestion(row: typeof permissions.$inferSelect): Promise<void> {
  const scope = asA2AQuestionScope(row.scope_json);
  if (!scope || !row.peer_id) return;

  // The owner may have removed the contact between holding the question and
  // approving it; the consent gate is the authority on who may spend their
  // budget, so don't answer a peer that is no longer connected.
  const connected = await isContact(row.user_id, row.peer_id);
  if (!connected) return;

  const db = getDb();

  const [inbound] = await db
    .select({ content: messages.content })
    .from(messages)
    .where(eq(messages.id, scope.inbound_message_id))
    .limit(1);
  if (!inbound?.content) return;

  const [existingReply] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.in_reply_to, scope.inbound_message_id))
    .limit(1);
  if (existingReply) return;

  // Re-read the specific agent the question was addressed to (a user may own
  // several agents), and confirm it still belongs to the approving owner.
  const [targetAgent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, scope.agent_id))
    .limit(1);
  if (!targetAgent || targetAgent.user_id !== row.user_id) return;

  const [senderPeer] = await db
    .select()
    .from(peerAgents)
    .where(eq(peerAgents.id, row.peer_id))
    .limit(1);
  if (!senderPeer) return;

  // Answer the full stored question, not the (possibly 500-char-truncated)
  // copy kept in scope_json for the inbox card.
  await processA2AMessage({
    targetAgent,
    senderDid: scope.sender_did,
    senderPeer,
    messageContent: inbound.content,
    conversationId: scope.conversation_id,
    inboundMessageId: scope.inbound_message_id,
  });
}
