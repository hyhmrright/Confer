import type { LLMMessage, LLMProvider, LLMStreamEvent } from '../llm/provider.js';

export interface AgentContext {
  agentId: string;
  userId: string;
  provider: LLMProvider;
  systemPrompt: string;
  conversationHistory: LLMMessage[];
}

function buildMessages(ctx: AgentContext, userMessage: string): LLMMessage[] {
  return [
    { role: 'system', content: ctx.systemPrompt },
    ...ctx.conversationHistory,
    { role: 'user', content: userMessage },
  ];
}

export async function runAgentLoop(ctx: AgentContext, userMessage: string): Promise<string> {
  const response = await ctx.provider.chat(buildMessages(ctx, userMessage));
  return response.content;
}

export async function* streamAgentLoop(
  ctx: AgentContext,
  userMessage: string,
): AsyncIterable<LLMStreamEvent> {
  yield* ctx.provider.stream(buildMessages(ctx, userMessage));
}
