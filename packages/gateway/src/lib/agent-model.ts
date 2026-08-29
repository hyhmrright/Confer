import { createProvider, type LLMProvider } from '@confer/agent-runtime';
import { err, llmProvider, ok, type Result } from '@confer/shared';
import { decryptUserKey } from './llm-keys.js';

/** Why an agent has no model to run a turn on. Machine codes: the client words them. */
export type ModelConfigError = 'no_model_configured' | 'unknown_provider' | 'no_key_for_provider';

export interface AgentModel {
  provider: LLMProvider;
  /** Undefined lets the provider fall back to the catalogue's default model. */
  model?: string;
}

/**
 * The provider an agent's turns run on, or the reason it has none.
 *
 * Both turn paths used to default the provider name to a hardcoded
 * `'anthropic'` when the agent had no model configured. An agent nobody had set
 * up therefore dialled a vendor its owner has no key for and failed with a bare
 * `401` — an authentication error for a misconfiguration, naming a vendor the
 * owner may never have heard of. On the A2A path it was worse than confusing:
 * the failure was logged here and nothing was sent, so the asking side's
 * consult simply stayed `pending` with no signal that it never could finish.
 */
export async function resolveAgentModel(
  modelConfig: Record<string, unknown> | null,
  llmKeys: Record<string, unknown>,
  encryptionKey: string,
): Promise<Result<AgentModel, ModelConfigError>> {
  const name = typeof modelConfig?.provider === 'string' ? modelConfig.provider : '';
  if (!name) return err('no_model_configured');

  const spec = llmProvider(name);
  if (!spec) return err('unknown_provider');

  const apiKey = await decryptUserKey(llmKeys, name, encryptionKey);
  // A local runtime keeps its address in the key slot and authenticates with
  // nothing, so an empty slot there means the catalogue's default address, not
  // a missing credential.
  if (!apiKey && !spec.keyIsBaseUrl) return err('no_key_for_provider');

  const provider = createProvider(name, apiKey);
  if (!provider) return err('unknown_provider');

  const model = typeof modelConfig?.model === 'string' ? modelConfig.model || undefined : undefined;
  return ok({ provider, model });
}
