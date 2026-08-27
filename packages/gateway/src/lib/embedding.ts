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

// The hosted providers output VECTOR_SIZE dimensions on request; Ollama does
// not, and `toVectorSize` reconciles it.
const PROVIDERS = {
  openai: {
    url: 'https://api.openai.com/v1/embeddings',
    model: 'text-embedding-3-small',
    dimensionParam: 'dimensions' as const,
    keyIsBaseUrl: false,
  },
  glm: {
    url: 'https://open.bigmodel.cn/api/paas/v4/embeddings',
    model: 'embedding-3',
    dimensionParam: 'dimensions' as const,
    keyIsBaseUrl: false,
  },
  qwen: {
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings',
    model: 'text-embedding-v3',
    dimensionParam: 'dimension' as const,
    keyIsBaseUrl: false,
  },
  // Ollama runs on the owner's own machine, so it has no fixed URL and no API
  // key. The settings UI stores its base URL in the slot the hosted providers
  // use for a key — the same trick the chat provider already plays — so here
  // `apiKey` IS the base URL and no Authorization header is sent.
  ollama: {
    url: '',
    model: 'nomic-embed-text',
    dimensionParam: 'dimensions' as const,
    keyIsBaseUrl: true,
  },
} as const;

export type EmbeddingProvider = keyof typeof PROVIDERS;

// Priority order when auto-selecting a provider from the user's stored keys.
// Ollama is last so that configuring a local chat model never quietly takes
// embeddings away from a hosted key the owner already had.
export const EMBEDDING_PROVIDER_PRIORITY: EmbeddingProvider[] = ['openai', 'glm', 'qwen', 'ollama'];

/** The concrete embedding model a provider uses, recorded on stored vectors. */
export function providerModel(provider: EmbeddingProvider): string {
  return PROVIDERS[provider].model;
}

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

// Bring a provider's native output up to VECTOR_SIZE. Ollama ignores the
// requested dimension and always returns nomic-embed-text's 768; zero-padding
// leaves cosine similarity untouched (padding moves neither the dot product nor
// either norm), so padded vectors rank exactly as they did at 768. Sharing one
// collection across providers is already the design — every point records the
// provider that produced it and queries filter on it.
function toVectorSize(vector: number[], provider: EmbeddingProvider): number[] {
  if (vector.length === VECTOR_SIZE) return vector;
  if (vector.length > VECTOR_SIZE) {
    throw new Error(
      `${provider} returned ${vector.length} dimensions, more than VECTOR_SIZE (${VECTOR_SIZE})`,
    );
  }
  return [...vector, ...new Array(VECTOR_SIZE - vector.length).fill(0)];
}

async function embedBatch(
  texts: string[],
  apiKey: string,
  provider: EmbeddingProvider,
): Promise<number[][]> {
  const { url, model, dimensionParam, keyIsBaseUrl } = PROVIDERS[provider];
  const endpoint = keyIsBaseUrl ? `${apiKey.replace(/\/+$/, '')}/v1/embeddings` : url;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!keyIsBaseUrl) headers.Authorization = `Bearer ${apiKey}`;
  const body: Record<string, unknown> = { input: texts, model, [dimensionParam]: VECTOR_SIZE };

  // Retry transient failures (429/5xx/timeout); 4xx fail fast. The thrown
  // HttpError carries the status so the retry classifier can decide.
  return retryWithBackoff(async () => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(EMBEDDING_API_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new HttpError(res.status, `${provider} embeddings failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as EmbeddingResponse;
    return data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => toVectorSize(d.embedding, provider));
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
