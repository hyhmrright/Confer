import { llmProvider, providerBaseUrl } from '@confer/shared';
import { AnthropicProvider } from './anthropic.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { Fetcher, LLMProvider } from './provider.js';

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
 * rather than dial an arbitrary host. `fetcher` is how the provider reaches its
 * vendor, whichever wire shape it speaks; the gateway passes one for a local
 * runtime.
 */
export function createProvider(
  name: string,
  apiKey: string,
  fetcher?: Fetcher,
): LLMProvider | null {
  const spec = llmProvider(name);
  if (!spec) return null;

  const baseUrl = providerBaseUrl(spec, apiKey);
  if (spec.kind === 'anthropic') {
    return new AnthropicProvider(apiKey, baseUrl, fetcher);
  }

  return new OpenAICompatibleProvider(
    spec.id,
    // Local runtimes store their address in the key slot and authenticate with
    // nothing, so the key is not also a credential.
    spec.keyIsBaseUrl ? '' : apiKey,
    baseUrl,
    spec.defaultModel ?? '',
    spec.completionsPath,
    fetcher,
  );
}
