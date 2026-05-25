import type { LLMProvider, LLMMessage, LLMStreamEvent } from '../llm/provider.js';

export interface AgentContext {
  agentId: string;
  userId: string;
  provider: LLMProvider;
  systemPrompt: string;
  conversationHistory: LLMMessage[];
}

export async function runAgentLoop(
  ctx: AgentContext,
  userMessage: string,
): Promise<string> {
  const messages: LLMMessage[] = [
    { role: 'system', content: ctx.systemPrompt },
    ...ctx.conversationHistory,
    { role: 'user', content: userMessage },
  ];

  const response = await ctx.provider.chat(messages);
  return response.content;
}

export async function* streamAgentLoop(
  ctx: AgentContext,
  userMessage: string,
): AsyncIterable<LLMStreamEvent> {
  const messages: LLMMessage[] = [
    { role: 'system', content: ctx.systemPrompt },
    ...ctx.conversationHistory,
    { role: 'user', content: userMessage },
  ];

  yield* ctx.provider.stream(messages);
}
