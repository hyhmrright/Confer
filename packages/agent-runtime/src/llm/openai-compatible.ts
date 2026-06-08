import type {
  LLMChatOptions,
  LLMMessage,
  LLMProvider,
  LLMResponse,
  LLMStreamEvent,
} from './provider.js';
import { readSSEData } from './stream-utils.js';

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

  constructor(
    name: string,
    apiKey: string,
    baseUrl: string,
    defaultModel: string,
    completionsPath = '/v1/chat/completions',
  ) {
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

    const data = (await response.json()) as Record<string, unknown>;
    const choices = data.choices as Array<Record<string, unknown>>;
    const choice = choices[0];
    if (!choice) {
      throw new Error(`${this.name} API returned no choices`);
    }
    const message = choice.message as Record<string, string>;

    const choiceFinish = choice.finish_reason as string | undefined;
    return {
      content: message.content ?? '',
      finish_reason:
        choiceFinish === 'tool_calls' ? 'tool_use' : choiceFinish === 'length' ? 'length' : 'stop',
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

    const pendingCalls = new Map<number, { id: string; name: string; arguments: string }>();

    for await (const payload of readSSEData(response.body)) {
      const chunk = payload.trim();
      if (chunk === '[DONE]') {
        for (const [, tc] of pendingCalls) {
          yield {
            type: 'tool_call',
            tool_call: { id: tc.id, name: tc.name, arguments: tc.arguments },
          };
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
          let entry = pendingCalls.get(idx);
          if (!entry) {
            entry = { id: '', name: '', arguments: '' };
            pendingCalls.set(idx, entry);
          }
          if (tc.id) entry.id = tc.id as string;
          const fn = tc.function as Record<string, string> | undefined;
          if (fn?.name) entry.name = fn.name;
          if (fn?.arguments) entry.arguments += fn.arguments;
        }
      }
    }
  }
}

/**
 * General-purpose factory for any OpenAI-compatible endpoint. The named
 * factories below delegate to this; callers wiring a custom endpoint can use it
 * directly. Defaults to the OpenAI base URL/model and the standard
 * `/v1/chat/completions` path.
 */
export function createOpenAICompatibleProvider(
  name: string,
  apiKey: string,
  opts: { baseUrl?: string; model?: string; completionsPath?: string } = {},
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider(
    name,
    apiKey,
    opts.baseUrl ?? 'https://api.openai.com',
    opts.model ?? 'gpt-4o',
    opts.completionsPath ?? '/v1/chat/completions',
  );
}

export function createDeepSeekProvider(apiKey: string): OpenAICompatibleProvider {
  return createOpenAICompatibleProvider('deepseek', apiKey, {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  });
}

export function createOpenAIProvider(apiKey: string): OpenAICompatibleProvider {
  return createOpenAICompatibleProvider('openai', apiKey, {
    baseUrl: 'https://api.openai.com',
    model: 'gpt-4o',
  });
}

export function createQwenProvider(apiKey: string): OpenAICompatibleProvider {
  return createOpenAICompatibleProvider('qwen', apiKey, {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode',
    model: 'qwen-plus',
  });
}

export function createGlmProvider(apiKey: string): OpenAICompatibleProvider {
  // GLM API uses /chat/completions directly under its v4 base path
  return createOpenAICompatibleProvider('glm', apiKey, {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    completionsPath: '/chat/completions',
  });
}

export function createOllamaProvider(baseUrl = 'http://localhost:11434'): OpenAICompatibleProvider {
  return createOpenAICompatibleProvider('ollama', '', { baseUrl, model: 'llama3' });
}
