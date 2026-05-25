import type { LLMProvider, LLMMessage, LLMResponse, LLMStreamEvent, LLMChatOptions } from './provider.js';

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(name: string, apiKey: string, baseUrl: string, defaultModel: string) {
    this.name = name;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.defaultModel = defaultModel;
  }

  async chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMResponse> {
    const model = options?.model ?? this.defaultModel;

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
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

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
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
  return new OpenAICompatibleProvider(
    'deepseek',
    apiKey,
    'https://api.deepseek.com',
    'deepseek-chat',
  );
}
