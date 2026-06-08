import { createProvider } from '@confer/agent-runtime';
import type { LLMMessage, LLMToolDefinition } from '@confer/agent-runtime';
import type { LLMProvider } from '@confer/agent-runtime';
import { AppError, newId } from '@confer/shared';
import { and, asc, eq, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import type { SSEStreamingApi } from 'hono/streaming';
import { streamSSE } from 'hono/streaming';
import { getDb } from '../db/connection.js';
import { agents, knowledgeBases, messages } from '../db/schema.js';
import { getEnv } from '../env.js';
import { assertIsConversationParticipant } from '../lib/conversation-auth.js';
import type { EmbeddingProvider } from '../lib/embedding.js';
import { decryptUserKey, getUserLlmKeys, resolveEmbeddingKey } from '../lib/llm-keys.js';
import { ensureMemoryCollection } from '../lib/memory-store.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  type KbCitation,
  knowledgeBaseToolDefinition,
  searchKnowledgeBase,
} from '../tools/knowledge-base.js';
import { extractAndStore, recallMemories } from '../tools/memory.js';
import { tavilySearch, tavilyToolDefinition } from '../tools/tavily.js';
import type { AppEnv } from '../types.js';
import { broadcastToConversation } from '../ws/handler.js';

export const streamRoutes = new Hono<AppEnv>();

streamRoutes.use('/*', authMiddleware);

function buildSystemPrompt(base: string, hasKb: boolean): string {
  const kbInstruction = hasKb
    ? '用户已上传了私有知识库文档。遇到任何关于文档内容、产品资料、内部知识的问题，必须先调用 search_knowledge_base 工具搜索，再基于搜索结果回答，不要凭记忆回答。'
    : '';
  return [base, kbInstruction].filter(Boolean).join('\n');
}

const DEFAULT_SYSTEM_PROMPT =
  '你是一个智能助手，能够帮助用户回答问题、处理任务。你可以使用 web_search 工具搜索实时信息。回答时请用用户使用的语言。';

// Assemble the tool set offered to the LLM: web search when a Tavily key
// resolves, knowledge-base search when the user has at least one KB.
function buildToolDefinitions(tavilyApiKey: string, hasKb: boolean): LLMToolDefinition[] {
  return [
    ...(tavilyApiKey ? [tavilyToolDefinition] : []),
    ...(hasKb ? [knowledgeBaseToolDefinition] : []),
  ];
}

interface ToolExecContext {
  userId: string;
  embeddingKey: string;
  embeddingProvider: EmbeddingProvider;
  tavilyApiKey: string;
  citations: KbCitation[];
}

// Execute a single tool call and return its textual result. Knowledge-base
// citations are appended to `ctx.citations` and streamed live so the capsule
// shows during the response. Tool errors are caught and returned as text so a
// failing tool never aborts the agent loop.
async function executeToolCall(
  tc: { id: string; name: string; arguments: string },
  ctx: ToolExecContext,
  stream: SSEStreamingApi,
): Promise<string> {
  try {
    if (tc.name === 'web_search') {
      const args = JSON.parse(tc.arguments) as { query: string };
      return await tavilySearch(args.query, ctx.tavilyApiKey);
    }
    if (tc.name === 'search_knowledge_base') {
      const args = JSON.parse(tc.arguments) as { query: string; kb_ids?: string[] };
      const kbResult = await searchKnowledgeBase(
        args.query,
        ctx.userId,
        ctx.embeddingKey,
        args.kb_ids,
        ctx.embeddingProvider,
      );
      ctx.citations.push(...kbResult.citations);
      // Stream citations live so the capsule shows during the response,
      // matching the shape the client maps persisted citations to.
      for (const cite of kbResult.citations) {
        await stream.writeSSE({
          event: 'citation',
          data: JSON.stringify({
            source: `${cite.doc_name}（${cite.kb_name}）`,
            passage: cite.excerpt,
          }),
        });
      }
      return kbResult.text;
    }
    return `未知工具: ${tc.name}`;
  } catch (err) {
    return `工具调用失败: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// Drive the agentic tool loop (up to 5 rounds), streaming tokens, tool calls,
// and tool results over SSE. Returns the accumulated reply text; collected
// knowledge-base citations are accumulated into `ctx.citations`.
async function runAgentWithTools(
  provider: LLMProvider,
  initialMessages: LLMMessage[],
  tools: LLMToolDefinition[],
  ctx: ToolExecContext,
  stream: SSEStreamingApi,
): Promise<string> {
  let agentMessages = initialMessages;
  let fullContent = '';

  for (let round = 0; round < 5; round++) {
    const pendingToolCalls: Array<{ id: string; name: string; arguments: string }> = [];
    let turnContent = '';

    for await (const event of provider.stream(agentMessages, { tools })) {
      switch (event.type) {
        case 'token':
          if (event.text) {
            turnContent += event.text;
            fullContent += event.text;
            await stream.writeSSE({
              event: 'token',
              data: JSON.stringify({ text: event.text }),
            });
          }
          break;
        case 'tool_call':
          if (event.tool_call) pendingToolCalls.push(event.tool_call);
          break;
      }
    }

    if (pendingToolCalls.length === 0) break;

    // Append assistant turn with tool_calls in proper format
    agentMessages = [
      ...agentMessages,
      {
        role: 'assistant',
        content: turnContent || null,
        tool_calls: pendingToolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      },
    ];

    for (const tc of pendingToolCalls) {
      await stream.writeSSE({ event: 'tool', data: JSON.stringify({ tool: tc.name }) });

      const result = await executeToolCall(tc, ctx, stream);

      await stream.writeSSE({
        event: 'tool_result',
        data: JSON.stringify({ result }),
      });

      agentMessages = [...agentMessages, { role: 'tool', content: result, tool_call_id: tc.id }];
    }
  }

  return fullContent;
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

      const tools = buildToolDefinitions(tavilyApiKey, userKbs.length > 0);

      // Recall durable memories for this user and inject them into the system
      // prompt. Best-effort: never fail the request on memory errors.
      let memoryFragment = '';
      if (embeddingKey) {
        try {
          await ensureMemoryCollection();
          memoryFragment = await recallMemories(
            msg.content ?? '',
            user.sub,
            embeddingKey,
            embeddingProvider,
          );
        } catch (err) {
          console.error(`Memory recall failed for user ${user.sub}:`, err);
        }
      }

      const effectiveSystemPrompt =
        buildSystemPrompt(systemPrompt, userKbs.length > 0) + memoryFragment;

      const initialMessages: LLMMessage[] = [
        { role: 'system', content: effectiveSystemPrompt },
        ...history,
        { role: 'user', content: msg.content ?? '' },
      ];

      const citations: KbCitation[] = [];
      const fullContent = await runAgentWithTools(
        provider,
        initialMessages,
        tools,
        { userId: user.sub, embeddingKey, embeddingProvider, tavilyApiKey, citations },
        stream,
      );

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
