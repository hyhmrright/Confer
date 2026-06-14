import type { LLMMessage, LLMProvider, LLMToolDefinition } from '@confer/agent-runtime';
import {
  type KbCitation,
  knowledgeBaseToolDefinition,
  searchKnowledgeBase,
} from '../tools/knowledge-base.js';
import { recallMemories } from '../tools/memory.js';
import { tavilySearch, tavilyToolDefinition } from '../tools/tavily.js';
import type { EmbeddingProvider } from './embedding.js';
import { ensureMemoryCollection } from './memory-store.js';

// Shared agent orchestration core for both the web chat (streaming) and inbound
// A2A (non-streaming) reply paths. Both consume `provider.stream` and drive the
// same tool loop; the only difference is whether streaming side effects are
// emitted, which callers opt into via the optional `emit` callbacks.

// Optional streaming side effects. The web chat path wires these to SSE writes;
// the A2A path omits `emit` entirely and just collects the final result.
export interface AgentTurnEmit {
  onToken?: (text: string) => void | Promise<void>;
  onTool?: (name: string) => void | Promise<void>;
  onToolResult?: (result: string) => void | Promise<void>;
  onCitation?: (citation: KbCitation) => void | Promise<void>;
}

export interface RunAgentTurnOptions {
  provider: LLMProvider;
  // Base system prompt before the KB instruction + memory fragment are layered
  // on. Sourced per caller (chat: model_config.system_prompt; A2A: agent.description).
  systemPromptBase: string;
  history: LLMMessage[];
  userMessage: string;
  userId: string;
  // Empty string when the owner has no usable embedding key: disables recall.
  embeddingKey: string;
  embeddingProvider: EmbeddingProvider;
  // Empty string when no Tavily key resolves: web_search is then not offered.
  tavilyApiKey: string;
  hasKb: boolean;
  emit?: AgentTurnEmit;
}

export interface RunAgentTurnResult {
  content: string;
  citations: KbCitation[];
}

function buildSystemPrompt(base: string, hasKb: boolean): string {
  const kbInstruction = hasKb
    ? '用户已上传了私有知识库文档。遇到任何关于文档内容、产品资料、内部知识的问题，必须先调用 search_knowledge_base 工具搜索，再基于搜索结果回答，不要凭记忆回答。'
    : '';
  return [base, kbInstruction].filter(Boolean).join('\n');
}

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
  emit?: AgentTurnEmit;
}

// Execute a single tool call and return its textual result. Knowledge-base
// citations are appended to `ctx.citations` and surfaced live via `emit.onCitation`
// so the streaming capsule shows during the response. Tool errors are caught and
// returned as text so a failing tool never aborts the agent loop.
async function executeToolCall(
  tc: { id: string; name: string; arguments: string },
  ctx: ToolExecContext,
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
      for (const cite of kbResult.citations) {
        await ctx.emit?.onCitation?.(cite);
      }
      return kbResult.text;
    }
    return `未知工具: ${tc.name}`;
  } catch (err) {
    return `工具调用失败: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// Drive the agentic tool loop (up to 5 rounds), consuming `provider.stream`.
// Tokens, tool calls, and tool results are surfaced via the optional `emit`
// callbacks. Returns the accumulated reply text; collected knowledge-base
// citations are accumulated into `ctx.citations`.
async function runAgentWithTools(
  provider: LLMProvider,
  initialMessages: LLMMessage[],
  tools: LLMToolDefinition[],
  ctx: ToolExecContext,
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
            await ctx.emit?.onToken?.(event.text);
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
      await ctx.emit?.onTool?.(tc.name);

      const result = await executeToolCall(tc, ctx);

      await ctx.emit?.onToolResult?.(result);

      agentMessages = [...agentMessages, { role: 'tool', content: result, tool_call_id: tc.id }];
    }
  }

  return fullContent;
}

// Run one agent turn: recall durable memories, layer the KB instruction +
// memory fragment onto the base system prompt, offer the resolved tools, and
// drive the tool loop. Memory recall is best-effort — a failure is logged
// (userId only, never message content) and the turn proceeds without it.
export async function runAgentTurn(opts: RunAgentTurnOptions): Promise<RunAgentTurnResult> {
  let memoryFragment = '';
  if (opts.embeddingKey) {
    try {
      await ensureMemoryCollection();
      memoryFragment = await recallMemories(
        opts.userMessage,
        opts.userId,
        opts.embeddingKey,
        opts.embeddingProvider,
      );
    } catch (err) {
      console.error(`Memory recall failed for user ${opts.userId}:`, err);
    }
  }

  const effectiveSystemPrompt =
    buildSystemPrompt(opts.systemPromptBase, opts.hasKb) + memoryFragment;
  const tools = buildToolDefinitions(opts.tavilyApiKey, opts.hasKb);

  const initialMessages: LLMMessage[] = [
    { role: 'system', content: effectiveSystemPrompt },
    ...opts.history,
    { role: 'user', content: opts.userMessage },
  ];

  const citations: KbCitation[] = [];
  const content = await runAgentWithTools(opts.provider, initialMessages, tools, {
    userId: opts.userId,
    embeddingKey: opts.embeddingKey,
    embeddingProvider: opts.embeddingProvider,
    tavilyApiKey: opts.tavilyApiKey,
    citations,
    emit: opts.emit,
  });

  return { content, citations };
}
