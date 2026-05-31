import type { LLMMessage, LLMProvider } from '@confer/agent-runtime';

const EXTRACTION_SYSTEM_PROMPT = `你是一个记忆抽取器。从给定的对话片段中，抽取关于「用户」的持久、稳定的事实：偏好、身份、长期目标、正在进行的项目、重要约束等。
规则：
- 只抽取值得长期记住的事实，忽略一次性的闲聊、寒暄、临时问答。
- 每条事实是一个独立、自包含的简短陈述句（中文）。
- 不要抽取关于 AI 助手自己的内容。
- 严格只输出一个 JSON 字符串数组，不要任何解释或 markdown 代码块。
- 如果没有值得记住的事实，输出 []。`;

function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

// Extract durable facts about the user from a conversation snippet. Returns []
// on any parse failure — extraction is a best-effort enhancement, never fatal.
export async function extractFacts(provider: LLMProvider, recentTurns: string): Promise<string[]> {
  const messages: LLMMessage[] = [
    { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
    { role: 'user', content: recentTurns },
  ];
  const res = await provider.chat(messages, { temperature: 0 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(res.content));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}
