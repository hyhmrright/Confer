const BATCH_SIZE = 50;
export const VECTOR_SIZE = 1536;

// All providers output (or can be configured to output) VECTOR_SIZE dimensions.
const PROVIDERS = {
  openai: {
    url: 'https://api.openai.com/v1/embeddings',
    model: 'text-embedding-3-small',
    dimensionParam: 'dimensions' as const,
  },
  glm: {
    url: 'https://open.bigmodel.cn/api/paas/v4/embeddings',
    model: 'embedding-3',
    dimensionParam: 'dimensions' as const,
  },
  qwen: {
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings',
    model: 'text-embedding-v3',
    dimensionParam: 'dimension' as const,
  },
} as const;

export type EmbeddingProvider = keyof typeof PROVIDERS;

// Priority order when auto-selecting a provider from the user's stored keys.
export const EMBEDDING_PROVIDER_PRIORITY: EmbeddingProvider[] = ['openai', 'glm', 'qwen'];

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

async function embedBatch(
  texts: string[],
  apiKey: string,
  provider: EmbeddingProvider,
): Promise<number[][]> {
  const { url, model, dimensionParam } = PROVIDERS[provider];
  const body: Record<string, unknown> = { input: texts, model, [dimensionParam]: VECTOR_SIZE };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${provider} embeddings failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as EmbeddingResponse;
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function embedTexts(
  texts: string[],
  apiKey: string,
  provider: EmbeddingProvider = 'openai',
): Promise<number[][]> {
  if (!apiKey) throw new Error('API key required for embeddings');
  if (texts.length === 0) return [];

  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const vectors = await embedBatch(batch, apiKey, provider);
    results.push(...vectors);
  }
  return results;
}
