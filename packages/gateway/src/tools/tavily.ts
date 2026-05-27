interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  results: TavilyResult[];
  answer?: string;
}

export async function tavilySearch(query: string, apiKey: string): Promise<string> {
  if (!apiKey) return '搜索功能未配置（缺少 TAVILY_API_KEY）';

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: 5,
      include_answer: true,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed: ${response.status}`);
  }

  const data = await response.json() as TavilyResponse;

  const parts: string[] = [];
  if (data.answer) parts.push(`摘要：${data.answer}`);
  for (const r of data.results) {
    parts.push(`[${r.title}](${r.url})\n${r.content}`);
  }
  return parts.join('\n\n');
}

export const tavilyToolDefinition = {
  name: 'web_search',
  description: '搜索互联网获取实时信息，包括天气、新闻、价格等最新数据',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索查询词' },
    },
    required: ['query'],
  },
} as const;
