export interface LLMToolCallBlock {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: LLMToolCallBlock[];
  tool_call_id?: string;
  /**
   * The prompt up to and including this message will recur on the next
   * request, so a provider with explicit caching should mark it. Only a hint:
   * a provider that caches on its own, or not at all, ignores it. Flag one
   * message; if several are, only the last counts.
   */
  cache_breakpoint?: boolean;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LLMUsage {
  /** Every input token, cached or not — what the prompt was, not what it cost. */
  prompt_tokens: number;
  completion_tokens: number;
  /**
   * How many of `prompt_tokens` the vendor served from its prompt cache.
   * Undefined when it did not say, which is not the same as zero.
   */
  cached_tokens?: number;
  /**
   * How many of `prompt_tokens` were written INTO the cache — billed above the
   * normal input rate by vendors with explicit caching (Anthropic: 1.25×), so a
   * write nothing later reads is a cost, not a saving. Undefined as above.
   */
  cache_write_tokens?: number;
}

export interface LLMResponse {
  content: string;
  tool_calls?: LLMToolCall[];
  finish_reason: 'stop' | 'tool_use' | 'length';
  usage: LLMUsage;
}

export interface LLMStreamEvent {
  type: 'token' | 'tool_call' | 'done';
  text?: string;
  tool_call?: LLMToolCall;
  usage?: LLMUsage;
}

export interface LLMProvider {
  readonly name: string;

  chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMResponse>;

  stream(messages: LLMMessage[], options?: LLMChatOptions): AsyncIterable<LLMStreamEvent>;
}

export interface LLMChatOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  tools?: LLMToolDefinition[];
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * How a provider sends its HTTP requests: the global `fetch`, unless the caller
 * has to decide where the connection goes. The gateway passes one pinned to the
 * address it checked for a local runtime (`gateway/src/lib/runtime-url.ts`).
 */
export type Fetcher = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<Response>;
