import type { LLMProvider, LLMMessage, LLMResponse, LLMStreamEvent, LLMChatOptions } from './provider.js';

function toOpenAIMessage(m: LLMMessage): Record<string, unknown> {
  if (m.role === 'tool') {
    return { role: 'tool', content: m.content ?? '', tool_call_id: m.tool_call_id };
  }
  if (m.tool_calls) {
    return { role: 'assistant', content: m.content, tool_calls: m.tool_calls };
  }
  return { role: m.role, content: m.content ?? '' };
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;
  private completionsPath: string;

  constructor(name: string, apiKey: string, baseUrl: string, defaultModel: string, completionsPath = '/v1/chat/completions') {
    this.name = name;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.defaultModel = defaultModel;
    this.completionsPath = completionsPath;
  }

  async chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMResponse> {
    const model = options?.model ?? this.defaultModel;

    const response = await fetch(`${this.baseUrl}${this.completionsPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: messages.map(toOpenAIMessage),
        temperature: options?.temperature,
        max_tokens: options?.max_tokens ?? 4096,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${this.name} API error (${response.status}): ${text}`);
    }

    const data = await response.json() as Record<string, unknown>;
    const choices = data.choices as Array<Record<string, unknown>>;
    const choice = choices[0]!;
    const message = choice.message as Record<string, string>;

    return {
      content: message.content ?? '',
      finish_reason: (choice.finish_reason as string) === 'stop' ? 'stop' : 'stop',
      usage: {
        prompt_tokens: (data.usage as Record<string, number>).prompt_tokens ?? 0,
        completion_tokens: (data.usage as Record<string, number>).completion_tokens ?? 0,
      },
    };
  }

  async *stream(messages: LLMMessage[], options?: LLMChatOptions): AsyncIterable<LLMStreamEvent> {
    const model = options?.model ?? this.defaultModel;

    const body: Record<string, unknown> = {
      model,
      messages: messages.map(toOpenAIMessage),
      temperature: options?.temperature,
      max_tokens: options?.max_tokens ?? 4096,
      stream: true,
    };
    if (options?.tools?.length) {
      body.tools = options.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = 'auto';
    }

    const response = await fetch(`${this.baseUrl}${this.completionsPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      throw new Error(`${this.name} stream error: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const pendingCalls = new Map<number, { id: string; name: string; arguments: string }>();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const chunk = line.slice(6).trim();
        if (chunk === '[DONE]') {
          for (const [, tc] of pendingCalls) {
            yield { type: 'tool_call', tool_call: { id: tc.id, name: tc.name, arguments: tc.arguments } };
          }
          yield { type: 'done' };
          return;
        }

        const data = JSON.parse(chunk) as Record<string, unknown>;
        const choices = data.choices as Array<Record<string, unknown>>;
        const delta = choices[0]?.delta as Record<string, unknown> | undefined;

        if (delta?.content) {
          yield { type: 'token', text: delta.content as string };
        }

        const toolCalls = delta?.tool_calls as Array<Record<string, unknown>> | undefined;
        if (toolCalls) {
          for (const tc of toolCalls) {
            const idx = (tc.index as number) ?? 0;
            if (!pendingCalls.has(idx)) {
              pendingCalls.set(idx, { id: '', name: '', arguments: '' });
            }
            const entry = pendingCalls.get(idx)!;
            if (tc.id) entry.id = tc.id as string;
            const fn = tc.function as Record<string, string> | undefined;
            if (fn?.name) entry.name = fn.name;
            if (fn?.arguments) entry.arguments += fn.arguments;
          }
        }
      }
    }
  }
}

export function createDeepSeekProvider(apiKey: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider('deepseek', apiKey, 'https://api.deepseek.com', 'deepseek-chat');
}

export function createOpenAIProvider(apiKey: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider('openai', apiKey, 'https://api.openai.com', 'gpt-4o');
}

export function createQwenProvider(apiKey: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider('qwen', apiKey, 'https://dashscope.aliyuncs.com/compatible-mode', 'qwen-plus');
}

export function createGlmProvider(apiKey: string): OpenAICompatibleProvider {
  // GLM API uses /chat/completions directly under its v4 base path
  return new OpenAICompatibleProvider('glm', apiKey, 'https://open.bigmodel.cn/api/paas/v4', 'glm-4-flash', '/chat/completions');
}

export function createOllamaProvider(baseUrl = 'http://localhost:11434'): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider('ollama', '', baseUrl, 'llama3');
}
