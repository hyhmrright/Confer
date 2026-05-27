const BATCH_SIZE = 50;
const MODEL = 'text-embedding-3-small';

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

async function embedBatch(texts: string[], apiKey: string): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input: texts, model: MODEL }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI embeddings failed (${res.status}): ${text}`);
  }

  const data = await res.json() as EmbeddingResponse;
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function embedTexts(texts: string[], apiKey: string): Promise<number[][]> {
  if (!apiKey) throw new Error('OpenAI API key required for embeddings');
  if (texts.length === 0) return [];

  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const vectors = await embedBatch(batch, apiKey);
    results.push(...vectors);
  }
  return results;
}
