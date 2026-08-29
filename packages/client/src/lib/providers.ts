// Presentation layer over the shared provider catalogue: which vendors get a
// localized alias, and how a provider's name is written out.
//
// The vendors themselves — base URLs, model endpoints, embedding support — live
// in `@confer/shared`'s catalogue, which the gateway and the agent runtime read
// from too. This file used to keep its own copy of that list plus a hand-written
// table of model IDs per provider. The IDs were the problem the catalogue is
// meant to end: they had no source, went stale silently, and named models like
// `deepseek-v4-pro` that no vendor has ever served. The model list now comes
// from the vendor's own `/models` endpoint, every time.
//
// Brand and model names stay verbatim (proper nouns); only generic
// parentheticals are localized.

import { LLM_PROVIDERS, type LlmProviderSpec } from '@confer/shared';
import type { TFunction } from 'i18next';
import type { TranslationKey } from '../i18n/index.js';

export interface ToolProvider {
  id: string;
  nameKey: TranslationKey;
  descriptionKey: TranslationKey;
  placeholder: string;
}

export const TOOL_PROVIDERS: ToolProvider[] = [
  {
    id: 'tavily',
    nameKey: 'providers.tavilyName',
    descriptionKey: 'providers.tavilyDescription',
    placeholder: 'tvly-...',
  },
];

export type { LlmProviderSpec };
export { LLM_PROVIDERS };

// Vendors whose name a Chinese or Japanese reader knows in another script.
// Absent from this map means the brand name is the whole name.
const PROVIDER_ALIAS: Record<string, TranslationKey> = {
  qwen: 'providers.qwenAlias',
  glm: 'providers.glmAlias',
  moonshot: 'providers.moonshotAlias',
  doubao: 'providers.doubaoAlias',
  siliconflow: 'providers.siliconflowAlias',
  ollama: 'providers.ollamaAlias',
};

// Display name for an LLM provider: appends the localized alias in parentheses
// when one exists (e.g. "Qwen (通义千问)").
export function llmProviderName(provider: LlmProviderSpec, t: TFunction): string {
  const alias = PROVIDER_ALIAS[provider.id];
  return alias ? `${provider.label} (${t(alias)})` : provider.label;
}
