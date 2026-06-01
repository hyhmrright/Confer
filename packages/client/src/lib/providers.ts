// Presentation catalog for the settings UI: tool/LLM provider display metadata
// and the static fallback model lists. Kept out of the component so the catalog
// is editable in one place.
//
// Brand and model names stay verbatim (proper nouns); only the generic
// parenthetical annotations are localized via i18n tag keys (see
// `i18n/locales/*.ts` providers.*). `toolProviderName`/`toolProviderDescription`
// and `llmProviderName` resolve their localized parts at call time.

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

export interface LlmProvider {
  id: string;
  name: string;
  aliasKey?: TranslationKey;
  supportsEmbedding?: boolean;
  isLocal?: boolean;
}

export const LLM_PROVIDERS: LlmProvider[] = [
  { id: 'anthropic', name: 'Anthropic (Claude)' },
  { id: 'openai', name: 'OpenAI', supportsEmbedding: true },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'qwen', name: 'Qwen', aliasKey: 'providers.qwenAlias', supportsEmbedding: true },
  { id: 'glm', name: 'GLM', aliasKey: 'providers.glmAlias', supportsEmbedding: true },
  { id: 'ollama', name: 'Ollama', aliasKey: 'providers.ollamaAlias', isLocal: true },
];

export interface StaticModel {
  value: string;
  // Brand/model name, kept verbatim.
  name: string;
  // i18n key for the generic annotation shown in parentheses.
  tagKey?: TranslationKey;
}

export const STATIC_MODELS: Record<string, StaticModel[]> = {
  anthropic: [
    { value: 'claude-opus-4-7', name: 'Claude Opus 4.7', tagKey: 'providers.tagFlagship' },
    { value: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', tagKey: 'providers.tagValue' },
    {
      value: 'claude-haiku-4-5-20251001',
      name: 'Claude Haiku 4.5',
      tagKey: 'providers.tagLight',
    },
  ],
  openai: [
    { value: 'gpt-5', name: 'GPT-5', tagKey: 'providers.tagFlagship' },
    { value: 'gpt-5-mini', name: 'GPT-5 mini', tagKey: 'providers.tagValue' },
    { value: 'o3', name: 'o3', tagKey: 'providers.tagFlagshipReasoning' },
    { value: 'o4-mini', name: 'o4-mini', tagKey: 'providers.tagValueReasoning' },
    { value: 'gpt-4.1', name: 'GPT-4.1', tagKey: 'providers.tagLongContext' },
    { value: 'gpt-4.1-mini', name: 'GPT-4.1 mini' },
    { value: 'gpt-4o', name: 'GPT-4o', tagKey: 'providers.tagMultimodal' },
    { value: 'gpt-4o-mini', name: 'GPT-4o mini' },
  ],
  deepseek: [
    { value: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', tagKey: 'providers.tagFlagship' },
    { value: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', tagKey: 'providers.tagValue' },
  ],
  qwen: [
    { value: 'qwen3-max', name: 'Qwen3-Max', tagKey: 'providers.tagFlagship' },
    { value: 'qwq-plus', name: 'QwQ-Plus', tagKey: 'providers.tagReasoning' },
    { value: 'qwen3.5-plus', name: 'Qwen3.5-Plus', tagKey: 'providers.tagSuperLongContext' },
    { value: 'qwen3.5-flash', name: 'Qwen3.5-Flash', tagKey: 'providers.tagLight' },
    { value: 'qwen-plus', name: 'Qwen-Plus', tagKey: 'providers.tagStableAlias' },
    { value: 'qwen-flash', name: 'Qwen-Flash', tagKey: 'providers.tagLightAlias' },
    { value: 'qwen-long', name: 'Qwen-Long', tagKey: 'providers.tagLongDoc' },
  ],
  glm: [
    { value: 'glm-5.1', name: 'GLM-5.1', tagKey: 'providers.tagLatestFlagship' },
    { value: 'glm-5', name: 'GLM-5', tagKey: 'providers.tagHighIntelligence' },
    { value: 'glm-5-turbo', name: 'GLM-5-Turbo', tagKey: 'providers.tagComplexTask' },
    { value: 'glm-4.7', name: 'GLM-4.7', tagKey: 'providers.tagGeneral' },
    { value: 'glm-4.6', name: 'GLM-4.6', tagKey: 'providers.tagCodingReasoning' },
    { value: 'glm-4.5-air', name: 'GLM-4.5-Air', tagKey: 'providers.tagValue' },
    { value: 'glm-4.5-airx', name: 'GLM-4.5-AirX', tagKey: 'providers.tagFast' },
    { value: 'glm-4-long', name: 'GLM-4-Long', tagKey: 'providers.tagMillionContext' },
    { value: 'glm-4.7-flash', name: 'GLM-4.7-Flash', tagKey: 'providers.tagFree' },
    { value: 'glm-4.7-flashx', name: 'GLM-4.7-FlashX', tagKey: 'providers.tagLightPaid' },
  ],
  ollama: [],
};

// Display name for an LLM provider: appends the localized alias in parentheses
// when one exists (e.g. "Qwen (通义千问)").
export function llmProviderName(provider: LlmProvider, t: TFunction): string {
  return provider.aliasKey ? `${provider.name} (${t(provider.aliasKey)})` : provider.name;
}

// Display label for a model option: brand name plus the localized annotation in
// parentheses when present (e.g. "Claude Opus 4.7 (flagship)").
export function modelLabel(model: StaticModel, t: TFunction): string {
  return model.tagKey ? `${model.name} (${t(model.tagKey)})` : model.name;
}
