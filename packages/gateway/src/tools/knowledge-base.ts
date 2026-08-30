import type { LLMProvider } from '@confer/agent-runtime';
import { type EmbeddingProvider, embedTexts } from '../lib/embedding.js';
import { type SearchResult, searchChunks } from '../lib/qdrant.js';
import { RECALL_DEPTH, RERANK_TO } from '../lib/rag-config.js';
import { rerankCandidates } from '../lib/rerank.js';

export interface KbCitation {
  kb_name: string;
  doc_name: string;
  excerpt: string;
  score: number;
}

/**
 * The model to rerank with — the same one the turn itself runs on.
 *
 * Optional because reranking costs a model call: callers that have no provider,
 * or that would rather not spend one, get the plain vector ranking and the
 * shallower search that goes with it.
 */
export interface KbRerank {
  provider: LLMProvider;
  model?: string;
}

export async function searchKnowledgeBase(
  query: string,
  userId: string,
  apiKey: string,
  kbIds?: string[],
  provider: EmbeddingProvider = 'openai',
  rerank?: KbRerank,
): Promise<{ text: string; citations: KbCitation[] }> {
  const vectors = await embedTexts([query], apiKey, provider);
  const vector = vectors[0] as number[];

  // Retrieve wide when something will narrow it again, and only then: at depth
  // 20 precision falls from 29.5% to 14.9% on the eval corpus, so handing 20
  // passages straight to the model would trade a better answer for a worse one.
  const limit = rerank ? RECALL_DEPTH : RERANK_TO;

  // Filter to the current provider's points (+ legacy untagged) and drop
  // low-similarity noise so cross-provider near-random hits stay out of context.
  const results: SearchResult[] = await searchChunks(vector, userId, kbIds, limit, provider, 0.3);

  if (results.length === 0) {
    return { text: '知识库中未找到相关内容。', citations: [] };
  }

  const ranked = rerank ? await applyRerank(query, results, rerank) : results;

  const citations: KbCitation[] = ranked.map((r) => ({
    kb_name: r.kb_name,
    doc_name: r.doc_name,
    excerpt: r.text,
    score: r.score,
  }));

  const parts = ranked.map((r, i) => `[来源 ${i + 1}：${r.doc_name}（${r.kb_name}）]\n${r.text}`);

  return { text: parts.join('\n\n'), citations };
}

async function applyRerank(
  query: string,
  results: SearchResult[],
  rerank: KbRerank,
): Promise<SearchResult[]> {
  const order = await rerankCandidates({
    query,
    candidates: results.map((r) => ({ text: r.text })),
    provider: rerank.provider,
    model: rerank.model,
    topN: RERANK_TO,
  });
  // `order` is already validated against the candidate count, so every index
  // resolves; the filter is for the type, not for safety.
  return order.map((index) => results[index]).filter((r): r is SearchResult => r !== undefined);
}

export const knowledgeBaseToolDefinition = {
  name: 'search_knowledge_base',
  description: '在用户的私有知识库中搜索相关内容，适用于查询企业 wiki、文档、内部资料等',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索查询词，用自然语言描述要查找的内容' },
    },
    required: ['query'],
  },
} as const;
