import type {
  LLMChatOptions,
  LLMMessage,
  LLMProvider,
  LLMToolDefinition,
} from '@confer/agent-runtime';
import { getEnv } from '../env.js';
import type { EmbeddingProvider } from '../lib/embedding.js';
import type { TurnAudience } from '../lib/llm-keys.js';
import { ensureMemoryCollection } from '../lib/memory-store.js';
import { recordAgentTurn } from '../lib/telemetry.js';
import {
  listContacts,
  listContactsToolDefinition,
  listKnowledgeBases,
  listKnowledgeBasesToolDefinition,
  searchMemory,
  searchMemoryToolDefinition,
} from '../tools/introspect.js';
import {
  type KbCitation,
  type KbRerank,
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
  // The only knowledge bases this turn may search. Undefined means no limit
  // (the owner asking their own agent); an array is a hard ceiling, and an
  // empty one admits nothing.
  kbScope?: string[];
  // False on an inbound A2A turn: the owner's long-term memory never rides in
  // a prompt whose answer leaves the instance. Required, not optional-with-a-
  // default, for the same reason `audience` is: the permissive value must never
  // be what a caller lands on by saying nothing.
  recallMemory: boolean;
  // Who the answer is going to. Required for the same reason `recallMemory` is:
  // the permissive value is what a forgotten argument lands on, and this is the
  // argument deciding whether a stranger's question can list the owner's
  // contacts or search their long-term memory.
  audience: TurnAudience;
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

// Assemble the tool set offered to the LLM. Each entry is gated on the thing
// that makes it work at all — a Tavily key, a knowledge base, an embedding key
// — and the two that read owner-only data are gated on the audience as well.
//
// Offering a tool is NOT how access is enforced. A model can emit a call for a
// name it was never given, and `executeToolCall` passes the arguments straight
// through, so every owner-only branch re-checks the audience there. This
// function decides what the model is *told about*; that one decides what runs.
function buildToolDefinitions(opts: RunAgentTurnOptions): LLMToolDefinition[] {
  const isOwner = opts.audience === 'owner';
  return [
    ...(opts.tavilyApiKey ? [tavilyToolDefinition] : []),
    ...(opts.hasKb ? [knowledgeBaseToolDefinition, listKnowledgeBasesToolDefinition] : []),
    ...(isOwner && opts.embeddingKey ? [searchMemoryToolDefinition] : []),
    ...(isOwner ? [listContactsToolDefinition] : []),
  ];
}

interface ToolExecContext {
  userId: string;
  embeddingKey: string;
  embeddingProvider: EmbeddingProvider;
  tavilyApiKey: string;
  kbScope?: string[];
  audience: TurnAudience;
  // The turn's own model, reused to rerank knowledge-base hits. Passing it
  // rather than reaching for a provider inside `tools/` keeps the dependency
  // pointing the one way it is allowed to.
  rerank?: KbRerank;
  citations: KbCitation[];
  // Names of the tools the model asked for this turn, in order — attempts, not
  // successes, since the question it answers is whether the model reached for
  // the tool at all. An accumulator like `citations`: the loop fills it, the
  // caller reads it.
  toolsUsed: string[];
  emit?: AgentTurnEmit;
}

// Matches no kb_id, so the filtered search returns nothing. A real id is 26
// chars; this is deliberately not one.
const SEARCH_NOTHING = '-';

/**
 * Resolve the knowledge bases one `search_knowledge_base` call may read.
 *
 * `scope` is the ceiling and `requested` is the model's preference, so the
 * answer is their intersection. Two shapes need care, both because
 * `searchChunks` reads an absent list as "search everything":
 *
 *  - no scope → the model's request stands, including `undefined` for all;
 *  - a scope with nothing left after intersecting → `SEARCH_NOTHING`, a
 *    sentinel id, rather than `undefined`, which would search every knowledge
 *    base the owner has. A model that names only forbidden ids must come back
 *    empty-handed, not privileged.
 */
export function narrowKbIds(
  requested: string[] | undefined,
  scope: string[] | undefined,
): string[] | undefined {
  if (!scope) return requested;
  const allowed = requested ? requested.filter((id) => scope.includes(id)) : scope;
  return allowed.length > 0 ? allowed : [SEARCH_NOTHING];
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
        // `kb_ids` is not in the tool schema, but the model can put it in the
        // arguments anyway and this passes them straight through — so a scope
        // enforced by omitting the parameter would be no scope at all. Narrow,
        // never widen: within a scope the model may still choose a subset.
        narrowKbIds(args.kb_ids, ctx.kbScope),
        ctx.embeddingProvider,
        ctx.rerank,
      );
      ctx.citations.push(...kbResult.citations);
      for (const cite of kbResult.citations) {
        await ctx.emit?.onCitation?.(cite);
      }
      return kbResult.text;
    }
    if (tc.name === 'list_knowledge_bases') {
      return await listKnowledgeBases(ctx.userId, ctx.kbScope);
    }
    // The two owner-only tools re-check the audience rather than trusting that
    // they were never offered. A peer's question and the owner's instructions
    // reach the model as the same kind of text, so a model can be talked into
    // calling a name it was not given — and `executeToolCall` is the only place
    // that decides whether the call actually runs.
    if (tc.name === 'search_memory') {
      if (ctx.audience !== 'owner') return `未知工具: ${tc.name}`;
      const args = JSON.parse(tc.arguments) as { query: string };
      return await searchMemory(args.query, ctx.userId, ctx.embeddingKey, ctx.embeddingProvider);
    }
    if (tc.name === 'list_contacts') {
      if (ctx.audience !== 'owner') return `未知工具: ${tc.name}`;
      return await listContacts(ctx.userId);
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
  spend: TurnSpend,
): Promise<string> {
  let agentMessages = initialMessages;
  let fullContent = '';

  for (let round = 0; round < 5; round++) {
    const pendingToolCalls: Array<{ id: string; name: string; arguments: string }> = [];
    let turnContent = '';
    spend.rounds++;

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
        case 'done':
          // Summed across rounds, because a tool loop is several model calls
          // and the owner pays for the prompt again on each one — the round
          // count beside it is what makes a large number explicable.
          if (event.usage) {
            spend.usage = {
              prompt_tokens: (spend.usage?.prompt_tokens ?? 0) + event.usage.prompt_tokens,
              completion_tokens:
                (spend.usage?.completion_tokens ?? 0) + event.usage.completion_tokens,
            };
          }
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

/** What one turn spent, accumulated across the rounds of the tool loop. */
interface TurnSpend {
  rounds: number;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

function recallState(opts: RunAgentTurnOptions, recall: MemoryRecall | undefined): string {
  // `withheld` is a peer-audience turn, `off` is a missing embedding key. Worth
  // separating: one is a deliberate boundary, the other is a misconfiguration.
  if (!opts.recallMemory) return 'withheld';
  if (!opts.embeddingKey) return 'off';
  if (!recall) return 'failed';
  if (recall.hits.length === 0) return '0';
  return `${recall.hits.length}@${(recall.hits[0]?.score ?? 0).toFixed(2)}`;
}

function kbState(hasKb: boolean, toolsUsed: string[]): string {
  if (!hasKb) return 'none';
  return toolsUsed.includes('search_knowledge_base') ? 'searched' : 'unsearched';
}

// Run one agent turn: recall durable memories, layer the KB instruction +
// memory fragment onto the base system prompt, offer the resolved tools, and
// drive the tool loop. Memory recall is best-effort — a failure is logged
// (userId only, never message content) and the turn proceeds without it.
export async function runAgentTurn(opts: RunAgentTurnOptions): Promise<RunAgentTurnResult> {
  let recall: MemoryRecall | undefined;
  if (opts.embeddingKey && opts.recallMemory) {
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
  const tools = buildToolDefinitions(opts);

  const initialMessages: LLMMessage[] = [
    { role: 'system', content: effectiveSystemPrompt },
    ...opts.history,
    { role: 'user', content: opts.userMessage },
  ];

  const citations: KbCitation[] = [];
  const toolsUsed: string[] = [];
  const spend: TurnSpend = { rounds: 0 };
  const startedAt = Date.now();

  const record = (error?: unknown): void =>
    recordAgentTurn({
      userId: opts.userId,
      audience: opts.audience,
      provider: opts.provider.name,
      model: opts.model,
      durationMs: Date.now() - startedAt,
      rounds: spend.rounds,
      usage: spend.usage,
      recall: recallState(opts, recall),
      kb: kbState(opts.hasKb, toolsUsed),
      citations: citations.length,
      tools: toolsUsed.length,
      errorType: error === undefined ? undefined : ((error as Error)?.constructor?.name ?? 'Error'),
    });

  // Recorded on the way out whether the turn succeeded or threw. A turn that
  // fails after three tool rounds has still been paid for, and it is the one an
  // owner most wants to find afterwards — logging only the successes would hide
  // exactly the turns worth looking at.
  try {
    const content = await runAgentWithTools(
      opts.provider,
      initialMessages,
      { tools, model: opts.model },
      {
        userId: opts.userId,
        embeddingKey: opts.embeddingKey,
        embeddingProvider: opts.embeddingProvider,
        tavilyApiKey: opts.tavilyApiKey,
        kbScope: opts.kbScope,
        audience: opts.audience,
        // Off unless the operator turned it on: it spends an extra model call
        // per search, and the measurement that justified the recall headroom did
        // not establish that any given chat model can exploit it. See env.ts.
        rerank: getEnv().RERANK_ENABLED
          ? { provider: opts.provider, model: opts.model }
          : undefined,
        citations,
        toolsUsed,
        emit: opts.emit,
      },
      spend,
    );

    record();
    return { content, citations };
  } catch (error) {
    record(error);
    throw error;
  }
}
