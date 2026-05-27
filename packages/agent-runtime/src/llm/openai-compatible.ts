import type { LLMProvider, LLMMessage, LLMResponse, LLMStreamEvent, LLMChatOptions } from './provider.js';

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
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
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

    const response = await fetch(`${this.baseUrl}${this.completionsPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: options?.temperature,
        max_tokens: options?.max_tokens ?? 4096,
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`${this.name} stream error: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const content = line.slice(6).trim();
        if (content === '[DONE]') {
          yield { type: 'done' };
          return;
        }

        const data = JSON.parse(content) as Record<string, unknown>;
        const choices = data.choices as Array<Record<string, unknown>>;
        const delta = choices[0]?.delta as Record<string, string> | undefined;
        if (delta?.content) {
          yield { type: 'token', text: delta.content };
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
