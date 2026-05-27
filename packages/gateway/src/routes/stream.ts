import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { authMiddleware } from '../middleware/auth.js';
import { getDb } from '../db/connection.js';
import { messages, agents, conversationParticipants, users, knowledgeBases } from '../db/schema.js';
import { eq, and, lt, asc } from 'drizzle-orm';
import { AppError, newId, decrypt } from '@confer/shared';
import { createProvider } from '@confer/agent-runtime';
import { getEnv } from '../env.js';
import { broadcastToConversation } from '../ws/handler.js';
import { tavilySearch, tavilyToolDefinition } from '../tools/tavily.js';
import { searchKnowledgeBase, knowledgeBaseToolDefinition, type KbCitation } from '../tools/knowledge-base.js';
import type { AppEnv } from '../types.js';
import type { LLMMessage, LLMToolDefinition } from '@confer/agent-runtime';

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

  const [msg] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);

  if (!msg || msg.conversation_id !== conversationId) {
    throw new AppError('not_found', 'Message not found', 404);
  }

  const [participant] = await db
    .select()
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversation_id, conversationId),
        eq(conversationParticipants.user_id, user.sub),
      ),
    )
    .limit(1);

  if (!participant) {
    throw new AppError('forbidden', 'Not a participant of this conversation', 403);
  }

  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.user_id, user.sub))
    .limit(1);

  if (!agent) {
    throw new AppError('not_found', 'Agent not configured', 404);
  }

  return streamSSE(c, async (stream) => {
    try {
      const modelConfig = agent.model_config_json as Record<string, unknown> | null;
      const providerName = (modelConfig?.provider as string) ?? 'anthropic';
      const systemPrompt = (modelConfig?.system_prompt as string) ?? DEFAULT_SYSTEM_PROMPT;

      const [userRow] = await db
        .select({ llm_keys_json: users.llm_keys_json })
        .from(users)
        .where(eq(users.id, user.sub))
        .limit(1);

      const llmKeys = (userRow?.llm_keys_json ?? {}) as Record<string, unknown>;
      const encryptedKey = llmKeys[providerName] as import('@confer/shared').EncryptedValue | undefined;
      let apiKey = '';
      if (encryptedKey) {
        const result = await decrypt(encryptedKey, env.ENCRYPTION_KEY);
        if (result.ok) apiKey = result.value;
      }

      const provider = createProvider(providerName, apiKey);
      if (!provider) {
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: 'No LLM provider configured' }) });
        return;
      }

      // Load up to 20 messages before this one as conversation history
      const historyRows = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversation_id, conversationId),
            lt(messages.id, messageId),
          ),
        )
        .orderBy(asc(messages.created_at))
        .limit(20);

      const history: LLMMessage[] = historyRows.map((m) => ({
        role: m.sender_type === 'user' ? 'user' : 'assistant',
        content: m.content ?? '',
      }));

      // Check if user has any knowledge bases
      let openAIKey = '';
      {
        const encryptedOpenAI = (llmKeys['openai'] ?? llmKeys['openai-compatible']) as import('@confer/shared').EncryptedValue | undefined;
        if (encryptedOpenAI) {
          const r = await decrypt(encryptedOpenAI, env.ENCRYPTION_KEY);
          if (r.ok) openAIKey = r.value;
        }
      }
      const userKbs = openAIKey
        ? await db.select({ id: knowledgeBases.id }).from(knowledgeBases).where(eq(knowledgeBases.user_id, user.sub))
        : [];

      const tools: LLMToolDefinition[] = [
        ...(env.TAVILY_API_KEY ? [tavilyToolDefinition] : []),
        ...(userKbs.length > 0 ? [knowledgeBaseToolDefinition] : []),
      ];
      let agentMessages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: msg.content ?? '' },
      ];

      let fullContent = '';
      const citations: KbCitation[] = [];

      // Agentic loop: up to 5 tool-call rounds
      for (let round = 0; round < 5; round++) {
        const pendingToolCalls: Array<{ id: string; name: string; arguments: string }> = [];
        let turnContent = '';

        for await (const event of provider.stream(agentMessages, { tools })) {
          switch (event.type) {
            case 'token':
              if (event.text) {
                turnContent += event.text;
                fullContent += event.text;
                await stream.writeSSE({ event: 'token', data: JSON.stringify({ text: event.text }) });
              }
              break;
            case 'tool_call':
              if (event.tool_call) pendingToolCalls.push(event.tool_call);
              break;
          }
        }

        if (pendingToolCalls.length === 0) break;

        // Append assistant turn to history
        agentMessages = [...agentMessages, { role: 'assistant', content: turnContent }];

        for (const tc of pendingToolCalls) {
          await stream.writeSSE({ event: 'tool', data: JSON.stringify({ tool: tc.name }) });

          let result = '';
          try {
            if (tc.name === 'web_search') {
              const args = JSON.parse(tc.arguments) as { query: string };
              result = await tavilySearch(args.query, env.TAVILY_API_KEY);
            } else if (tc.name === 'search_knowledge_base') {
              const args = JSON.parse(tc.arguments) as { query: string; kb_ids?: string[] };
              const kbResult = await searchKnowledgeBase(args.query, user.sub, openAIKey, args.kb_ids);
              result = kbResult.text;
              citations.push(...kbResult.citations);
            } else {
              result = `未知工具: ${tc.name}`;
            }
          } catch (err) {
            result = `工具调用失败: ${err instanceof Error ? err.message : String(err)}`;
          }

          await stream.writeSSE({ event: 'tool_result', data: JSON.stringify({ result: tc.name }) });

          // Inject tool result as user context for next round
          agentMessages = [
            ...agentMessages,
            { role: 'user', content: `[${tc.name} 搜索结果]\n${result}` },
          ];
        }
      }

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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Stream failed';
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ message }) });
    }
  });
});
