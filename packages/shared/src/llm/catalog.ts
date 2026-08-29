/*
  The one list of LLM providers.

  It used to be four lists that had to agree: the runtime's `createProvider`
  switch and its per-vendor factories (base URLs, default models), the gateway's
  `PROVIDERS` whitelist and its `providerModelUrl` map, and the client's
  `LLM_PROVIDERS` catalogue. Adding a vendor meant four edits in three packages,
  and the client's copy had drifted furthest — it carried a hand-written list of
  model IDs that nobody could keep current.

  Everything here is a protocol fact: where the vendor lives, which paths it
  answers on, and how it authenticates. Presentation (localized aliases, badges)
  stays in the client.

  Every `modelsPath` below was verified to exist by requesting it: each returns
  401/400 (reachable, needs a real key) or 200, never 404.
*/

export type LlmProviderKind = 'openai' | 'anthropic';

export interface LlmProviderSpec {
  id: string;
  /** Brand name, verbatim. A proper noun — never localized. */
  label: string;
  /** Wire protocol. Everything except Anthropic speaks OpenAI's shape. */
  kind: LlmProviderKind;
  /** Vendor origin plus any version prefix the vendor bakes into its base. */
  baseUrl: string;
  completionsPath: string;
  /** GET endpoint listing the account's available models, '' when there is none. */
  modelsPath: string;
  /**
   * Model used when the owner has not chosen one. Left empty for vendors whose
   * current model IDs we cannot state from here — the settings UI fetches the
   * real list, so guessing an ID would only produce a 404 at chat time. This is
   * deliberate: the previous client-side catalogue guessed, and shipped names
   * like `deepseek-v4-pro` that no vendor has ever served.
   */
  defaultModel?: string;
  /**
   * The stored "API key" is really a base URL. Used by local runtimes, which
   * have no fixed address and no key — the settings UI reuses the key slot.
   */
  keyIsBaseUrl?: boolean;
  /**
   * Also serves an embedding API. Must stay in step with the gateway's
   * `EMBEDDING_PROVIDER_PRIORITY`, which owns the embedding endpoints
   * themselves (different paths, different models).
   */
  supportsEmbedding?: boolean;
}

export const LLM_PROVIDERS: readonly LlmProviderSpec[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    completionsPath: '/v1/messages',
    modelsPath: '/v1/models',
    defaultModel: 'claude-sonnet-4-20250514',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com',
    completionsPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    defaultModel: 'gpt-4o',
    supportsEmbedding: true,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'openai',
    // Google's OpenAI-compatible surface: same request shape, Bearer auth, and
    // its own `/models` listing. The native `generativelanguage` API needs a
    // different response adapter; this one needs none.
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    completionsPath: '/chat/completions',
    modelsPath: '/models',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com',
    completionsPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    defaultModel: 'deepseek-chat',
  },
  {
    id: 'qwen',
    label: 'Qwen',
    kind: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode',
    completionsPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    defaultModel: 'qwen-plus',
    supportsEmbedding: true,
  },
  {
    id: 'glm',
    label: 'GLM',
    kind: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    completionsPath: '/chat/completions',
    modelsPath: '/models',
    defaultModel: 'glm-4-flash',
    supportsEmbedding: true,
  },
  {
    id: 'moonshot',
    label: 'Moonshot',
    kind: 'openai',
    baseUrl: 'https://api.moonshot.cn',
    completionsPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
  },
  {
    id: 'doubao',
    label: 'Volcengine Ark',
    kind: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    completionsPath: '/chat/completions',
    modelsPath: '/models',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    kind: 'openai',
    baseUrl: 'https://api.minimax.chat',
    completionsPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
  },
  {
    id: 'hunyuan',
    label: 'Tencent Hunyuan',
    kind: 'openai',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com',
    completionsPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    kind: 'openai',
    baseUrl: 'https://api.x.ai',
    completionsPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai',
    completionsPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai',
    completionsPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
  },
  {
    id: 'together',
    label: 'Together AI',
    kind: 'openai',
    baseUrl: 'https://api.together.xyz',
    completionsPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    kind: 'openai',
    baseUrl: 'https://api.fireworks.ai/inference',
    completionsPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api',
    completionsPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    kind: 'openai',
    baseUrl: 'https://api.siliconflow.cn',
    completionsPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    kind: 'openai',
    baseUrl: 'http://localhost:11434',
    completionsPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    defaultModel: 'llama3',
    keyIsBaseUrl: true,
    supportsEmbedding: true,
  },
];

export const LLM_PROVIDER_IDS: readonly string[] = LLM_PROVIDERS.map((p) => p.id);

export function llmProvider(id: string): LlmProviderSpec | undefined {
  return LLM_PROVIDERS.find((p) => p.id === id);
}

/**
 * Where to reach a provider for this owner. For local runtimes the stored
 * secret is the address, so it wins over the spec's default; a trailing slash
 * is dropped so joining a path never produces a doubled one.
 */
export function providerBaseUrl(spec: LlmProviderSpec, storedKey?: string): string {
  const base = spec.keyIsBaseUrl && storedKey ? storedKey : spec.baseUrl;
  return base.replace(/\/+$/, '');
}
