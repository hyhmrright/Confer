import { boundedMap } from './concurrency.js';
import {
  BATCH_SIZE,
  EMBED_BATCH_CONCURRENCY,
  EMBEDDING_API_TIMEOUT_MS,
  VECTOR_SIZE,
} from './rag-config.js';
import { HttpError, retryWithBackoff } from './retry.js';

// Re-exported so existing importers keep resolving VECTOR_SIZE from embedding.
export { VECTOR_SIZE };

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

/** The concrete embedding model a provider uses, recorded on stored vectors. */
export function providerModel(provider: EmbeddingProvider): string {
  return PROVIDERS[provider].model;
}

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

  // Retry transient failures (429/5xx/timeout); 4xx fail fast. The thrown
  // HttpError carries the status so the retry classifier can decide.
  return retryWithBackoff(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(EMBEDDING_API_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new HttpError(res.status, `${provider} embeddings failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as EmbeddingResponse;
    return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  });
}

export async function embedTexts(
  texts: string[],
  apiKey: string,
  provider: EmbeddingProvider = 'openai',
): Promise<number[][]> {
  if (!apiKey) throw new Error('API key required for embeddings');
  if (texts.length === 0) return [];

  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    batches.push(texts.slice(i, i + BATCH_SIZE));
  }

  // Embed batches with bounded concurrency (rate-limit friendly), then
  // concatenate in batch order to preserve the caller's text/chunk order.
  const batchVectors = await boundedMap(batches, EMBED_BATCH_CONCURRENCY, (batch) =>
    embedBatch(batch, apiKey, provider),
  );
  return batchVectors.flat();
}
