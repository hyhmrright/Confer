import type {
  LLMChatOptions,
  LLMMessage,
  LLMProvider,
  LLMResponse,
  LLMStreamEvent,
} from './provider.js';

function toAnthropicMessages(messages: LLMMessage[]): unknown[] {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content ?? '' }],
        };
      }
      if (m.tool_calls?.length) {
        const content: unknown[] = [];
        if (m.content) content.push({ type: 'text', text: m.content });
        for (const tc of m.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments || '{}'),
          });
        }
        return { role: 'assistant', content };
      }
      return { role: m.role, content: m.content ?? '' };
    });
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.anthropic.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMResponse> {
    const model = options?.model ?? 'claude-sonnet-4-20250514';
    const systemMessage = messages.find((m) => m.role === 'system');

    const body: Record<string, unknown> = {
      model,
      max_tokens: options?.max_tokens ?? 4096,
      messages: toAnthropicMessages(messages),
    };
    if (systemMessage) body.system = systemMessage.content;
    if (options?.temperature !== undefined) body.temperature = options.temperature;

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${text}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const content = (data.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return {
      content,
      finish_reason: data.stop_reason === 'end_turn' ? 'stop' : 'stop',
      usage: {
        prompt_tokens: (data.usage as Record<string, number>).input_tokens ?? 0,
        completion_tokens: (data.usage as Record<string, number>).output_tokens ?? 0,
      },
    };
  }

  async *stream(messages: LLMMessage[], options?: LLMChatOptions): AsyncIterable<LLMStreamEvent> {
    const model = options?.model ?? 'claude-sonnet-4-20250514';
    const systemMessage = messages.find((m) => m.role === 'system');

    const body: Record<string, unknown> = {
      model,
      max_tokens: options?.max_tokens ?? 4096,
      stream: true,
      messages: toAnthropicMessages(messages),
    };
    if (systemMessage) body.system = systemMessage.content;
    if (options?.tools?.length) {
      body.tools = options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Anthropic stream error: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Track tool_use blocks being streamed
    const pendingToolBlocks = new Map<number, { id: string; name: string; input: string }>();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = JSON.parse(line.slice(6)) as Record<string, unknown>;

        if (data.type === 'content_block_start') {
          const block = data.content_block as Record<string, unknown>;
          const index = data.index as number;
          if (block.type === 'tool_use') {
            pendingToolBlocks.set(index, {
              id: block.id as string,
              name: block.name as string,
              input: '',
            });
          }
        } else if (data.type === 'content_block_delta') {
          const delta = data.delta as Record<string, string>;
          const index = data.index as number;
          if (delta.type === 'text_delta' && delta.text) {
            yield { type: 'token', text: delta.text };
          } else if (delta.type === 'input_json_delta' && delta.partial_json) {
            const block = pendingToolBlocks.get(index);
            if (block) block.input += delta.partial_json;
          }
        } else if (data.type === 'message_stop') {
          for (const [, block] of pendingToolBlocks) {
            yield {
              type: 'tool_call',
              tool_call: { id: block.id, name: block.name, arguments: block.input || '{}' },
            };
          }
          yield { type: 'done' };
        }
      }
    }
  }
}
