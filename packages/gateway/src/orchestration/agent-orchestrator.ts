import type {
  LLMChatOptions,
  LLMMessage,
  LLMProvider,
  LLMToolDefinition,
} from '@confer/agent-runtime';
import type { EmbeddingProvider } from '../lib/embedding.js';
import { ensureMemoryCollection } from '../lib/memory-store.js';
import {
  type KbCitation,
  knowledgeBaseToolDefinition,
  searchKnowledgeBase,
} from '../tools/knowledge-base.js';
import { type MemoryRecall, recallMemories } from '../tools/memory.js';
import { tavilySearch, tavilyToolDefinition } from '../tools/tavily.js';

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
  // Model id from the owner's agent settings (`model_config.model`). Undefined
  // falls back to the provider's own default — which for Ollama is a model the
  // user almost certainly has not pulled, so leaving this unset 404s.
  model?: string;
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
  // Names of the tools the model asked for this turn, in order — attempts, not
  // successes, since the question it answers is whether the model reached for
  // the tool at all. An accumulator like `citations`: the loop fills it, the
  // caller reads it.
  toolsUsed: string[];
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
  llmOptions: LLMChatOptions,
  ctx: ToolExecContext,
): Promise<string> {
  let agentMessages = initialMessages;
  let fullContent = '';

  for (let round = 0; round < 5; round++) {
    const pendingToolCalls: Array<{ id: string; name: string; arguments: string }> = [];
    let turnContent = '';

    for await (const event of provider.stream(agentMessages, llmOptions)) {
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
      ctx.toolsUsed.push(tc.name);
      await ctx.emit?.onTool?.(tc.name);

      const result = await executeToolCall(tc, ctx);

      await ctx.emit?.onToolResult?.(result);

      agentMessages = [...agentMessages, { role: 'tool', content: result, tool_call_id: tc.id }];
    }
  }

  return fullContent;
}

/**
 * One line per turn saying what the turn was actually grounded in.
 *
 * Two things here have no other way to be noticed. Recall returning nothing has
 * three causes that all present as an empty prompt fragment — nothing stored,
 * nothing above the score floor, or rows that were never indexed — and the last
 * one hid for months. And the KB instruction *mandates* a search before
 * answering, yet a model that ignores it produces a fluent answer from its own
 * priors that reads exactly like a grounded one.
 *
 * Counts and scores only: memory text and message content are PII and stay out.
 */
function recallState(embeddingKey: string, recall: MemoryRecall | undefined): string {
  if (!embeddingKey) return 'off';
  if (!recall) return 'failed';
  if (recall.hits.length === 0) return '0';
  return `${recall.hits.length}@${(recall.hits[0]?.score ?? 0).toFixed(2)}`;
}

function kbState(hasKb: boolean, toolsUsed: string[]): string {
  if (!hasKb) return 'none';
  return toolsUsed.includes('search_knowledge_base') ? 'searched' : 'unsearched';
}

function logTurnGrounding(
  opts: RunAgentTurnOptions,
  recall: MemoryRecall | undefined,
  toolsUsed: string[],
  citations: KbCitation[],
): void {
  console.log(
    `agent turn user=${opts.userId}` +
      ` recall=${recallState(opts.embeddingKey, recall)}` +
      ` kb=${kbState(opts.hasKb, toolsUsed)}` +
      // `kb=searched` says the model obeyed the instruction, not that anything
      // came back: a search that matched nothing, or one that threw and was
      // handed to the model as error text, both still count as searched.
      ` cites=${citations.length}` +
      ` tools=${toolsUsed.length}`,
  );
}

// Run one agent turn: recall durable memories, layer the KB instruction +
// memory fragment onto the base system prompt, offer the resolved tools, and
// drive the tool loop. Memory recall is best-effort — a failure is logged
// (userId only, never message content) and the turn proceeds without it.
export async function runAgentTurn(opts: RunAgentTurnOptions): Promise<RunAgentTurnResult> {
  let recall: MemoryRecall | undefined;
  if (opts.embeddingKey) {
    try {
      await ensureMemoryCollection();
      recall = await recallMemories(
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
    buildSystemPrompt(opts.systemPromptBase, opts.hasKb) + (recall?.fragment ?? '');
  const tools = buildToolDefinitions(opts.tavilyApiKey, opts.hasKb);

  const initialMessages: LLMMessage[] = [
    { role: 'system', content: effectiveSystemPrompt },
    ...opts.history,
    { role: 'user', content: opts.userMessage },
  ];

  const citations: KbCitation[] = [];
  const toolsUsed: string[] = [];
  const content = await runAgentWithTools(
    opts.provider,
    initialMessages,
    { tools, model: opts.model },
    {
      userId: opts.userId,
      embeddingKey: opts.embeddingKey,
      embeddingProvider: opts.embeddingProvider,
      tavilyApiKey: opts.tavilyApiKey,
      citations,
      toolsUsed,
      emit: opts.emit,
    },
  );

  logTurnGrounding(opts, recall, toolsUsed, citations);

  return { content, citations };
}
