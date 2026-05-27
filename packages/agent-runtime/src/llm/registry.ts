import type { LLMProvider } from './provider.js';
import { AnthropicProvider } from './anthropic.js';
import {
  createDeepSeekProvider,
  createOpenAIProvider,
  createQwenProvider,
  createGlmProvider,
  createOllamaProvider,
} from './openai-compatible.js';

const providers = new Map<string, LLMProvider>();

export function registerProvider(provider: LLMProvider): void {
  providers.set(provider.name, provider);
}

export function getProvider(name: string): LLMProvider | undefined {
  return providers.get(name);
}

export function createProvider(name: string, apiKey: string): LLMProvider | null {
  switch (name) {
    case 'anthropic': return new AnthropicProvider(apiKey);
    case 'openai': return createOpenAIProvider(apiKey);
    case 'deepseek': return createDeepSeekProvider(apiKey);
    case 'qwen': return createQwenProvider(apiKey);
    case 'glm': return createGlmProvider(apiKey);
    case 'ollama': return createOllamaProvider(apiKey || undefined);
    default: return null;
  }
}
