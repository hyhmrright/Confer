import type { LLMProvider } from './provider.js';
import { AnthropicProvider } from './anthropic.js';
import { createDeepSeekProvider } from './openai-compatible.js';

const providers = new Map<string, LLMProvider>();

export function registerProvider(provider: LLMProvider): void {
  providers.set(provider.name, provider);
}

export function getProvider(name: string): LLMProvider | undefined {
  return providers.get(name);
}

export function initProviders(keys: { anthropic?: string; deepseek?: string }): void {
  if (keys.anthropic) {
    registerProvider(new AnthropicProvider(keys.anthropic));
  }
  if (keys.deepseek) {
    registerProvider(createDeepSeekProvider(keys.deepseek));
  }
}
