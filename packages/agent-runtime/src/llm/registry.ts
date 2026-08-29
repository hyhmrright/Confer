import { llmProvider, providerBaseUrl } from '@confer/shared';
import { AnthropicProvider } from './anthropic.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { LLMProvider } from './provider.js';

const providers = new Map<string, LLMProvider>();

export function registerProvider(provider: LLMProvider): void {
  providers.set(provider.name, provider);
}

export function getProvider(name: string): LLMProvider | undefined {
  return providers.get(name);
}

/**
 * Build a provider from the shared catalogue. This was a switch with one case
 * and one hand-written factory per vendor, so the base URLs lived here as well
 * as in the gateway's model-listing map — adding a vendor meant editing both.
 * Now a catalogue entry is the whole change.
 *
 * Returns null for an unknown name so callers can report a misconfiguration
 * rather than dial an arbitrary host.
 */
export function createProvider(name: string, apiKey: string): LLMProvider | null {
  const spec = llmProvider(name);
  if (!spec) return null;

  if (spec.kind === 'anthropic') {
    return new AnthropicProvider(apiKey, providerBaseUrl(spec));
  }

  return new OpenAICompatibleProvider(
    spec.id,
    // Local runtimes store their address in the key slot and authenticate with
    // nothing, so the key is not also a credential.
    spec.keyIsBaseUrl ? '' : apiKey,
    providerBaseUrl(spec, apiKey),
    spec.defaultModel ?? '',
    spec.completionsPath,
  );
}
