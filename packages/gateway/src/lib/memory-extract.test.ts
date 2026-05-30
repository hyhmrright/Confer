import { describe, expect, test } from 'bun:test';
import type { LLMMessage, LLMProvider, LLMResponse } from '@confer/agent-runtime';
import { extractFacts } from './memory-extract.js';

function fakeProvider(content: string): LLMProvider {
  return {
    name: 'fake',
    async chat(_messages: LLMMessage[]): Promise<LLMResponse> {
      return { content, finish_reason: 'stop', usage: { prompt_tokens: 0, completion_tokens: 0 } };
    },
    async *stream() {
      // not used in extraction
    },
  };
}

describe('extractFacts', () => {
  test('parses a JSON array of facts', async () => {
    const provider = fakeProvider('["用户在做 A2A 项目", "用户偏好 TypeScript"]');
    const facts = await extractFacts(provider, 'user: 我在做 A2A\nagent: 好的');
    expect(facts).toEqual(['用户在做 A2A 项目', '用户偏好 TypeScript']);
  });

  test('strips markdown code fences before parsing', async () => {
    const provider = fakeProvider('```json\n["事实一"]\n```');
    const facts = await extractFacts(provider, 'whatever');
    expect(facts).toEqual(['事实一']);
  });

  test('returns empty array when model outputs empty array', async () => {
    const provider = fakeProvider('[]');
    expect(await extractFacts(provider, 'hi')).toEqual([]);
  });

  test('returns empty array on unparseable output instead of throwing', async () => {
    const provider = fakeProvider('抱歉我无法处理');
    expect(await extractFacts(provider, 'hi')).toEqual([]);
  });

  test('drops non-string and empty entries', async () => {
    const provider = fakeProvider('["ok", "", 123, "  "]');
    expect(await extractFacts(provider, 'hi')).toEqual(['ok']);
  });
});
