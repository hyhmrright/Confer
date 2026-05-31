// Presentation catalog for the settings UI: tool/LLM provider display metadata
// and the static fallback model lists. Kept out of the component so the catalog
// is editable in one place.

export const TOOL_PROVIDERS = [
  {
    id: 'tavily',
    name: 'Tavily 网络搜索',
    description: '让 AI 能实时搜索网络，查询新闻、股价、天气等任意最新信息',
    placeholder: 'tvly-...',
  },
];

export const LLM_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic (Claude)' },
  { id: 'openai', name: 'OpenAI', supportsEmbedding: true },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'qwen', name: '通义千问 (Qwen)', supportsEmbedding: true },
  { id: 'glm', name: '智谱 AI (GLM)', supportsEmbedding: true },
  { id: 'ollama', name: 'Ollama (本地)', isLocal: true },
];

export const STATIC_MODELS: Record<string, { value: string; label: string }[]> = {
  anthropic: [
    { value: 'claude-opus-4-7', label: 'Claude Opus 4.7（旗舰）' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6（高性价比）' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5（轻量）' },
  ],
  openai: [
    { value: 'gpt-5', label: 'GPT-5（旗舰）' },
    { value: 'gpt-5-mini', label: 'GPT-5 mini（高性价比）' },
    { value: 'o3', label: 'o3（旗舰推理）' },
    { value: 'o4-mini', label: 'o4-mini（高性价比推理）' },
    { value: 'gpt-4.1', label: 'GPT-4.1（长上下文）' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
    { value: 'gpt-4o', label: 'GPT-4o（多模态）' },
    { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
  ],
  deepseek: [
    { value: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro（旗舰）' },
    { value: 'deepseek-v4-flash', label: 'DeepSeek-V4-Flash（高性价比）' },
  ],
  qwen: [
    { value: 'qwen3-max', label: 'Qwen3-Max（旗舰）' },
    { value: 'qwq-plus', label: 'QwQ-Plus（推理）' },
    { value: 'qwen3.5-plus', label: 'Qwen3.5-Plus（超长上下文）' },
    { value: 'qwen3.5-flash', label: 'Qwen3.5-Flash（轻量）' },
    { value: 'qwen-plus', label: 'Qwen-Plus（稳定别名）' },
    { value: 'qwen-flash', label: 'Qwen-Flash（轻量别名）' },
    { value: 'qwen-long', label: 'Qwen-Long（超长文档）' },
  ],
  glm: [
    { value: 'glm-5.1', label: 'GLM-5.1（最新旗舰）' },
    { value: 'glm-5', label: 'GLM-5（高智能）' },
    { value: 'glm-5-turbo', label: 'GLM-5-Turbo（复杂任务）' },
    { value: 'glm-4.7', label: 'GLM-4.7（通用）' },
    { value: 'glm-4.6', label: 'GLM-4.6（编程推理）' },
    { value: 'glm-4.5-air', label: 'GLM-4.5-Air（高性价比）' },
    { value: 'glm-4.5-airx', label: 'GLM-4.5-AirX（极速）' },
    { value: 'glm-4-long', label: 'GLM-4-Long（百万上下文）' },
    { value: 'glm-4.7-flash', label: 'GLM-4.7-Flash（免费）' },
    { value: 'glm-4.7-flashx', label: 'GLM-4.7-FlashX（轻量付费）' },
  ],
  ollama: [],
};
