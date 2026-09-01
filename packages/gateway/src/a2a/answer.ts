import type { LLMMessage } from '@confer/agent-runtime';
import { newId, type SystemNotice } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { agents, messages, peerAgents, type permissions } from '../db/schema.js';
import { getEnv } from '../env.js';
import { type ModelConfigError, resolveAgentModel } from '../lib/agent-model.js';
import { runDetached } from '../lib/background.js';
import { historyBefore } from '../lib/conversation-history.js';
import { getUserLlmKeys, resolveAgentCapabilities } from '../lib/llm-keys.js';
import { isContact } from '../lib/tenant.js';
import { runAgentTurn } from '../orchestration/agent-orchestrator.js';
import { extractAndStore } from '../tools/memory.js';
import { broadcastToConversation } from '../ws/handler.js';
import { asA2AQuestionScope } from './inbound-permissions.js';
import { type OutboundA2AMessage, sendA2AMessage } from './outbound.js';
import { loadOwnerSigningKey } from './signing.js';

export interface ProcessA2AMessageParams {
  targetAgent: typeof agents.$inferSelect;
  senderDid: string;
  senderPeer: typeof peerAgents.$inferSelect;
  messageContent: string;
  conversationId: string;
  /** The thread id the peer sent, which the reply must be addressed with. */
  peerThreadId?: string;
  inboundMessageId: string;
}

// The most recent 20 visible messages of an A2A thread as LLM history,
// excluding the current inbound message. The peer asking is the `user`; this
// agent's own prior replies are `assistant`, mirroring the chat path's role
// mapping. Moderator-hidden messages are excluded from the LLM context.
//
// This wrote the query itself and took the OLDEST twenty — the same defect the
// chat path was fixed for, left here because it could not surface while every
// inbound message opened a conversation of its own. Now that a thread persists
// past twenty messages, it would have. Both paths share `historyBefore`.
async function loadA2AHistory(
  conversationId: string,
  inboundMessageId: string,
): Promise<LLMMessage[]> {
  const rows = await historyBefore(conversationId, inboundMessageId, 20);

  return rows.map((m) => ({
    role: m.sender_type === 'peer_agent' ? 'user' : 'assistant',
    content: m.content ?? '',
  }));
}

/** Sign and deliver one outbound message in the peer's own thread. */
async function sendToPeer(
  params: ProcessA2AMessageParams,
  message: OutboundA2AMessage['message'],
): Promise<void> {
  const { targetAgent, senderDid, senderPeer, conversationId, peerThreadId } = params;

  if (!senderPeer.endpoint) {
    console.error(`No endpoint known for peer ${senderDid}, skipping outbound message`);
    return;
  }

  const key = await loadOwnerSigningKey(targetAgent.user_id);
  if (!key.ok) {
    console.error(`Cannot sign A2A message for agent ${targetAgent.id}: ${key.error}`);
    return;
  }

  const result = await sendA2AMessage(
    senderPeer.endpoint,
    {
      from: targetAgent.did,
      to: senderDid,
      // THEIR thread id, not ours. `resolveOrCreateThread` refuses a thread the
      // caller does not own — correctly, it is a tenant boundary — so a reply
      // carrying our conversation id was filed by the peer under a brand new
      // conversation, and the asker went on polling the one they had created.
      // Every consult therefore sat at `pending` forever while a perfectly good
      // answer existed on both machines.
      thread_id: peerThreadId ?? conversationId,
      message,
    },
    key.value.keyId,
    key.value.privateKeyJwk,
  );

  if (!result.ok) {
    console.error(`Failed to send A2A ${message.type} to ${senderDid}: ${result.error}`);
  }
}

type A2AFailure = ModelConfigError | 'agent_error';

/** One-line English summary of a turn that could not be run, sent to the asker. */
const FAILURE_NOTICE: Record<A2AFailure, string> = {
  no_model_configured: 'The agent you asked has no model configured yet.',
  unknown_provider: 'The agent you asked is configured with an unknown model provider.',
  no_key_for_provider: 'The agent you asked has no API key for its configured provider.',
  agent_error: 'The agent you asked could not complete this turn.',
};

/**
 * Record that this question will not be answered, on both sides.
 *
 * Silence is the wrong answer here and it is what this did: a failure was
 * logged on the answering side and nothing was written or sent, so the asker's
 * consult long-poll ran to its deadline and reported `pending` — forever, on
 * every retry, with no way to tell "still thinking" from "never coming" — while
 * the OWNER saw their peer's question sitting in the thread with nothing after
 * it and no hint that their model configuration was the reason.
 *
 * So two things happen. A row goes into the conversation, in reply to the
 * question, marked `system_notice` and carrying the machine code — that is what
 * the owner reads, what an A2A Task reports as `TASK_STATE_FAILED` instead of a
 * turn stuck at `WORKING`, and what stops `/stream/{id}` answering `pending`
 * for good. And a `notification` goes to the asker, which cannot provoke a
 * reply the way an `answer` would. Both carry the code rather than relying on
 * the sentence: the peer is another instance and the owner another locale, so
 * prose is the fallback and the code is the contract.
 */
async function notifyPeerOfFailure(
  params: ProcessA2AMessageParams,
  failure: A2AFailure,
): Promise<void> {
  const { targetAgent, conversationId, inboundMessageId } = params;
  const noticeId = newId();
  const notice: SystemNotice = { kind: 'a2a_turn_failed', error: failure };
  const prose = FAILURE_NOTICE[failure];

  await getDb().insert(messages).values({
    id: noticeId,
    conversation_id: conversationId,
    sender_type: 'own_agent',
    sender_id: targetAgent.id,
    sender_did: targetAgent.did,
    content_type: 'system_notice',
    content: prose,
    content_json: notice,
    in_reply_to: inboundMessageId,
    via: 'a2a',
  });

  broadcastToConversation(conversationId, {
    type: 'message.new',
    data: {
      id: noticeId,
      conversation_id: conversationId,
      sender_type: 'own_agent',
      sender_id: targetAgent.id,
      content: prose,
      in_reply_to: inboundMessageId,
    },
  });

  await sendToPeer(params, {
    type: 'notification',
    content: prose,
    context: { error: failure },
  });
}

export async function processA2AMessage(params: ProcessA2AMessageParams): Promise<void> {
  const { targetAgent, messageContent, conversationId, inboundMessageId } = params;

  const db = getDb();
  const env = getEnv();
  const llmKeys = await getUserLlmKeys(targetAgent.user_id);

  const resolved = await resolveAgentModel(
    targetAgent.model_config_json as Record<string, unknown> | null,
    llmKeys,
    env.ENCRYPTION_KEY,
  );
  if (!resolved.ok) {
    console.error(`Agent ${targetAgent.id} cannot answer: ${resolved.error}`);
    await notifyPeerOfFailure(params, resolved.error);
    return;
  }
  const { provider, model } = resolved.value;

  // Tools, recall, and extraction all spend the budget of the agent's owner —
  // never the requesting peer's. `'peer'` additionally bounds what the turn can
  // reach: only knowledge bases the owner marked shareable, and no long-term
  // memory. The reply goes back over the wire, and the peer's question reaches
  // the model as ordinary text, so the limit cannot live in the prompt.
  const { embeddingKey, embeddingProvider, tavilyApiKey, hasKb, kbScope, recallMemory } =
    await resolveAgentCapabilities(targetAgent.user_id, llmKeys, env, 'peer');

  const history = await loadA2AHistory(conversationId, inboundMessageId);

  // A rejected key, a provider outage, a model that no longer exists: each of
  // these ended the turn here with a log line and nothing on the wire, leaving
  // the asker to poll a question that would never be answered.
  const turn = await runAgentTurn({
    // An inbound peer's question; same value passed to
    // resolveAgentCapabilities above, and the two must not drift.
    audience: 'peer',
    provider,
    systemPromptBase: targetAgent.description ?? 'You are a helpful AI agent.',
    model,
    history,
    userMessage: messageContent,
    userId: targetAgent.user_id,
    embeddingKey,
    embeddingProvider,
    tavilyApiKey,
    hasKb,
    kbScope,
    recallMemory,
  }).catch((error) => {
    console.error(`Agent turn failed for agent ${targetAgent.id}:`, error);
    return null;
  });
  if (!turn) {
    await notifyPeerOfFailure(params, 'agent_error');
    return;
  }
  const { content: replyContent, citations } = turn;

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
    runDetached(
      extractAndStore({
        userId: targetAgent.user_id,
        provider,
        model,
        embeddingKey,
        embeddingProvider,
        recentTurns,
        source: 'a2a',
      }),
      (err) => console.error(`Memory extraction failed for user ${targetAgent.user_id}:`, err),
    );
  }

  await sendToPeer(params, { type: 'answer', content: replyContent });
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
    peerThreadId: scope.peer_thread_id,
    inboundMessageId: scope.inbound_message_id,
  });
}
