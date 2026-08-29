import type { LLMMessage } from '@confer/agent-runtime';
import { AppError, newId } from '@confer/shared';
import { and, desc, eq, lt } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getDb } from '../db/connection.js';
import { agents, messages } from '../db/schema.js';
import { getEnv } from '../env.js';
import { resolveAgentModel } from '../lib/agent-model.js';
import { getUserLlmKeys, resolveAgentCapabilities } from '../lib/llm-keys.js';
import { assertIsConversationParticipant } from '../lib/tenant.js';
import { authMiddleware } from '../middleware/auth.js';
import { runAgentTurn } from '../orchestration/agent-orchestrator.js';
import { extractAndStore } from '../tools/memory.js';
import type { AppEnv } from '../types.js';
import { broadcastToConversation } from '../ws/handler.js';

export const streamRoutes = new Hono<AppEnv>();

streamRoutes.use('/*', authMiddleware);

const DEFAULT_SYSTEM_PROMPT =
  '你是一个智能助手，能够帮助用户回答问题、处理任务。你可以使用 web_search 工具搜索实时信息。回答时请用用户使用的语言。';

/** How many earlier messages the model is shown. */
const HISTORY_WINDOW = 20;

/** A stream that emits a fixed set of events and ends. */
function sseEvents(c: Context<AppEnv>, events: Array<{ event: string; data: unknown }>): Response {
  return streamSSE(c, async (stream) => {
    for (const { event, data } of events) {
      await stream.writeSSE({ event, data: JSON.stringify(data) });
    }
  });
}

// Message id -> when its turn was claimed.
//
// This endpoint is a GET, but running it has side effects: it calls the model
// and inserts the reply. Nothing stopped it running twice for the same message,
// so a reload, a flaky connection, or a second tab billed another completion
// and appended a duplicate answer — reproduced live, two identical replies to
// one question 25 seconds apart. Process-local is the right scope: the gateway
// is single-instance by design, exactly like the WS registry, the nonce cache
// and the rate limiter.
const inFlight = new Map<string, number>();

// A claim is only honoured while it is fresh. Nothing bounds a turn: the LLM
// calls carry no timeout, so a provider that accepts the connection and then
// says nothing holds its claim forever — and because no reply row is ever
// written, that message could never be answered again, by any request, until
// the process restarted. Expiring the claim trades that dead end for a
// duplicate in the one case where a turn really is still running this long.
const CLAIM_TTL_MS = 5 * 60_000;

/** Take the claim for this message, unless a live one is already held. */
function claimTurn(messageId: string, now: number): boolean {
  const heldAt = inFlight.get(messageId);
  if (heldAt !== undefined && now - heldAt < CLAIM_TTL_MS) return false;
  inFlight.set(messageId, now);
  return true;
}

streamRoutes.get('/:conversationId/:messageId', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const env = getEnv();
  const conversationId = c.req.param('conversationId');
  const messageId = c.req.param('messageId');

  const [msg] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);

  if (!msg || msg.conversation_id !== conversationId) {
    throw new AppError('not_found', 'Message not found', 404);
  }

  await assertIsConversationParticipant(user.sub, conversationId);

  const [agent] = await db.select().from(agents).where(eq(agents.user_id, user.sub)).limit(1);

  if (!agent) {
    throw new AppError('not_found', 'Agent not configured', 404);
  }

  // Claim the message BEFORE looking for an answer. Reading the database first
  // is the obvious order and it is wrong: a request that finds no answer yet
  // can be descheduled long enough for the request holding the claim to finish,
  // insert and release, after which it sees a free slot and buys a second
  // completion. That race is the ordinary one — a reload arriving as the turn
  // lands.
  const claimed = claimTurn(messageId, Date.now());

  const [existing] = await db
    .select({ id: messages.id, content: messages.content })
    .from(messages)
    .where(eq(messages.in_reply_to, messageId))
    .limit(1);

  // Answered already: replay it. This is the reconnect after a finished turn,
  // and it must not leave the reader looking at an empty bubble.
  if (existing) {
    if (claimed) inFlight.delete(messageId);
    return sseEvents(c, [
      { event: 'token', data: { text: existing.content ?? '' } },
      { event: 'done', data: { message_id: existing.id } },
    ]);
  }

  // Someone else is generating it. Say so rather than starting a second turn —
  // the answer reaches every open client over the WS broadcast below, so
  // declining costs the reader nothing.
  if (!claimed) {
    return sseEvents(c, [{ event: 'error', data: { message: 'already_generating' } }]);
  }

  return streamSSE(c, async (stream) => {
    try {
      const modelConfig = agent.model_config_json as Record<string, unknown> | null;
      const systemPrompt = (modelConfig?.system_prompt as string) ?? DEFAULT_SYSTEM_PROMPT;

      const llmKeys = await getUserLlmKeys(user.sub);
      const resolved = await resolveAgentModel(modelConfig, llmKeys, env.ENCRYPTION_KEY);
      if (!resolved.ok) {
        // A machine code, not a sentence: the gateway has no locale context, and
        // the reader distinguishes "you have not chosen a model yet" from "the
        // provider you chose has no key" — different fixes, different screens.
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ message: resolved.error }),
        });
        return;
      }
      const { provider, model } = resolved.value;

      // The last HISTORY_WINDOW messages before this one, oldest-first for the
      // model. Ordering ascending and taking the first 20 — which is what this
      // did — hands back the twenty OLDEST messages instead, so past that many
      // the agent kept re-reading the start of the conversation and never saw
      // anything recent. Moderator-hidden messages stay out of the context.
      const historyRows = (
        await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.conversation_id, conversationId),
              lt(messages.id, messageId),
              eq(messages.moderation_status, 'visible'),
            ),
          )
          .orderBy(desc(messages.created_at))
          .limit(HISTORY_WINDOW)
      ).reverse();

      const history: LLMMessage[] = historyRows.map((m) => ({
        role: m.sender_type === 'user' ? 'user' : 'assistant',
        content: m.content ?? '',
      }));

      const { embeddingKey, embeddingProvider, tavilyApiKey, hasKb } =
        await resolveAgentCapabilities(user.sub, llmKeys, env);

      const { content: fullContent, citations } = await runAgentTurn({
        provider,
        systemPromptBase: systemPrompt,
        model,
        history,
        userMessage: msg.content ?? '',
        userId: user.sub,
        embeddingKey,
        embeddingProvider,
        tavilyApiKey,
        hasKb,
        emit: {
          onToken: (text) => stream.writeSSE({ event: 'token', data: JSON.stringify({ text }) }),
          onTool: (tool) => stream.writeSSE({ event: 'tool', data: JSON.stringify({ tool }) }),
          onToolResult: (result) =>
            stream.writeSSE({ event: 'tool_result', data: JSON.stringify({ result }) }),
          onCitation: (cite) =>
            stream.writeSSE({
              event: 'citation',
              data: JSON.stringify({
                source: `${cite.doc_name}（${cite.kb_name}）`,
                passage: cite.excerpt,
              }),
            }),
        },
      });

      const replyId = newId();
      await db.insert(messages).values({
        id: replyId,
        conversation_id: conversationId,
        sender_type: 'agent',
        sender_id: agent.id,
        content_type: 'text',
        content: fullContent,
        in_reply_to: messageId,
        citations_json: citations.length > 0 ? citations : undefined,
        delivered_at: new Date(),
      });

      broadcastToConversation(conversationId, {
        type: 'message.new',
        data: {
          id: replyId,
          conversation_id: conversationId,
          sender_type: 'agent',
          sender_id: agent.id,
          content: fullContent,
          in_reply_to: messageId,
        },
      });

      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ message_id: replyId }),
      });

      // Fire-and-forget: extract durable facts from this turn into long-term
      // memory. Never block or fail the response on memory errors.
      if (embeddingKey && fullContent) {
        const recentTurns = `用户：${msg.content ?? ''}\n助手：${fullContent}`;
        void extractAndStore({
          userId: user.sub,
          provider,
          model,
          embeddingKey,
          embeddingProvider,
          recentTurns,
        }).catch((err) => {
          console.error(`Memory extraction failed for user ${user.sub}:`, err);
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Stream failed';
      // Log server-side too: the SSE error reaches only that one client, so an
      // otherwise-clean log made provider misconfiguration invisible to operators.
      console.error(`Stream turn failed for user ${user.sub}: ${message}`);
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ message }) });
    } finally {
      // Released on failure too, or one dropped turn would wedge that message
      // permanently: no reply row exists to replay, and every retry would be
      // turned away as already generating.
      inFlight.delete(messageId);
    }
  });
});
