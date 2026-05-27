import { embedTexts } from '../lib/embedding.js';
import { searchChunks, type SearchResult } from '../lib/qdrant.js';

export interface KbCitation {
  kb_name: string;
  doc_name: string;
  excerpt: string;
  score: number;
}

export async function searchKnowledgeBase(
  query: string,
  userId: string,
  apiKey: string,
  kbIds?: string[],
): Promise<{ text: string; citations: KbCitation[] }> {
  const vectors = await embedTexts([query], apiKey);
  const vector = vectors[0] as number[];
  const results: SearchResult[] = await searchChunks(vector, userId, kbIds, 5);

  if (results.length === 0) {
    return { text: '知识库中未找到相关内容。', citations: [] };
  }

  const citations: KbCitation[] = results.map((r) => ({
    kb_name: r.kb_name,
    doc_name: r.doc_name,
    excerpt: r.text,
    score: r.score,
  }));

  const parts = results.map(
    (r, i) => `[来源 ${i + 1}：${r.doc_name}（${r.kb_name}）]\n${r.text}`,
  );

  return { text: parts.join('\n\n'), citations };
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
