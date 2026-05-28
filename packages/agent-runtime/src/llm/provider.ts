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
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LLMResponse {
  content: string;
  tool_calls?: LLMToolCall[];
  finish_reason: 'stop' | 'tool_use' | 'length';
  usage: { prompt_tokens: number; completion_tokens: number };
}

export interface LLMStreamEvent {
  type: 'token' | 'tool_call' | 'done';
  text?: string;
  tool_call?: LLMToolCall;
  usage?: { prompt_tokens: number; completion_tokens: number };
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
