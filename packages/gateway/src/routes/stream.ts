import { createProvider } from '@confer/agent-runtime';
import type { LLMMessage } from '@confer/agent-runtime';
import { AppError, newId } from '@confer/shared';
import { and, asc, eq, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getDb } from '../db/connection.js';
import { agents, knowledgeBases, messages } from '../db/schema.js';
import { getEnv } from '../env.js';
import { runAgentTurn } from '../lib/agent-orchestrator.js';
import { assertIsConversationParticipant } from '../lib/conversation-auth.js';
import type { EmbeddingProvider } from '../lib/embedding.js';
import { decryptUserKey, getUserLlmKeys, resolveEmbeddingKey } from '../lib/llm-keys.js';
import { authMiddleware } from '../middleware/auth.js';
import { extractAndStore } from '../tools/memory.js';
import type { AppEnv } from '../types.js';
import { broadcastToConversation } from '../ws/handler.js';

export const streamRoutes = new Hono<AppEnv>();

streamRoutes.use('/*', authMiddleware);

const DEFAULT_SYSTEM_PROMPT =
  '你是一个智能助手，能够帮助用户回答问题、处理任务。你可以使用 web_search 工具搜索实时信息。回答时请用用户使用的语言。';

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

  return streamSSE(c, async (stream) => {
    try {
      const modelConfig = agent.model_config_json as Record<string, unknown> | null;
      const providerName = (modelConfig?.provider as string) ?? 'anthropic';
      const systemPrompt = (modelConfig?.system_prompt as string) ?? DEFAULT_SYSTEM_PROMPT;

      const llmKeys = await getUserLlmKeys(user.sub);
      const apiKey = await decryptUserKey(llmKeys, providerName, env.ENCRYPTION_KEY);

      const provider = createProvider(providerName, apiKey);
      if (!provider) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ message: 'No LLM provider configured' }),
        });
        return;
      }

      // Load up to 20 messages before this one as conversation history.
      // Moderator-hidden messages are excluded so they don't flow into the LLM context.
      const historyRows = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversation_id, conversationId),
            lt(messages.id, messageId),
            eq(messages.moderation_status, 'visible'),
          ),
        )
        .orderBy(asc(messages.created_at))
        .limit(20);

      const history: LLMMessage[] = historyRows.map((m) => ({
        role: m.sender_type === 'user' ? 'user' : 'assistant',
        content: m.content ?? '',
      }));

      // Resolve embedding provider for knowledge base search
      const embeddingConfig = await resolveEmbeddingKey(llmKeys, env.ENCRYPTION_KEY);
      const embeddingKey = embeddingConfig?.apiKey ?? '';
      const embeddingProvider: EmbeddingProvider = embeddingConfig?.provider ?? 'openai';
      const userKbs = embeddingKey
        ? await db
            .select({ id: knowledgeBases.id })
            .from(knowledgeBases)
            .where(eq(knowledgeBases.user_id, user.sub))
        : [];

      const userTavilyKey = await decryptUserKey(llmKeys, 'tavily', env.ENCRYPTION_KEY);
      const tavilyApiKey = userTavilyKey || env.TAVILY_API_KEY;

      const { content: fullContent, citations } = await runAgentTurn({
        provider,
        systemPromptBase: systemPrompt,
        history,
        userMessage: msg.content ?? '',
        userId: user.sub,
        embeddingKey,
        embeddingProvider,
        tavilyApiKey,
        hasKb: userKbs.length > 0,
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
          embeddingKey,
          embeddingProvider,
          recentTurns,
        }).catch((err) => {
          console.error(`Memory extraction failed for user ${user.sub}:`, err);
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Stream failed';
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ message }) });
    }
  });
});
