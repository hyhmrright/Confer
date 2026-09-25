import { readCappedText } from '@confer/shared';
import type {
  Fetcher,
  LLMChatOptions,
  LLMMessage,
  LLMProvider,
  LLMResponse,
  LLMStreamEvent,
  LLMUsage,
} from './provider.js';
import { MAX_ERROR_BYTES, MAX_RESPONSE_BYTES, readSSEData } from './stream-utils.js';

type AnthropicBlock = Record<string, unknown>;
interface AnthropicMessage {
  role: string;
  content: string | AnthropicBlock[];
}

// Anthropic caches a prompt only up to a block that asks for it, and the cache
// is a PREFIX match in the order tools → system → messages: any byte that
// differs invalidates everything after it. A prompt below the model's minimum
// cacheable length is simply not cached — the request succeeds either way.
const CACHE_BREAKPOINT = { type: 'ephemeral' } as const;

/**
 * One text block per system message, the FIRST marked as a cache breakpoint.
 * The caller's contract: what is identical turn after turn goes in the first
 * system message, and anything that varies per turn (recalled memories) in a
 * later one. Joining them into one string, as this did, put the per-turn part
 * inside the only block there was, so nothing before it could be reused.
 */
function toAnthropicSystem(messages: LLMMessage[]): AnthropicBlock[] | undefined {
  const blocks: AnthropicBlock[] = messages
    // A whitespace-only text block is rejected just like an empty one.
    .filter((m) => m.role === 'system' && m.content?.trim())
    .map((m) => ({ type: 'text', text: m.content }));
  const [first] = blocks;
  if (!first) return undefined;
  first.cache_control = CACHE_BREAKPOINT;
  return blocks;
}

/**
 * Mark the conversation's last block as a breakpoint too. Within a turn every
 * tool round resends the whole conversation plus one more exchange, so round
 * two onward reads everything up to here from the cache instead of paying for
 * it again; across turns the same holds for the history, as long as nothing
 * earlier in the prompt changed.
 */
function withTrailingBreakpoint(messages: AnthropicMessage[]): AnthropicMessage[] {
  const last = messages.at(-1);
  if (!last) return messages;
  let blocks: AnthropicBlock[];
  if (typeof last.content !== 'string') {
    blocks = last.content;
  } else if (last.content.trim()) {
    blocks = [{ type: 'text', text: last.content }];
  } else {
    // An empty or blank text block is a 400, so such a message is left as the
    // plain string it was.
    return messages;
  }
  const tail = blocks.at(-1);
  if (!tail) return messages;
  return [
    ...messages.slice(0, -1),
    { ...last, content: [...blocks.slice(0, -1), { ...tail, cache_control: CACHE_BREAKPOINT }] },
  ];
}

/**
 * Input usage from one of Anthropic's usage objects. `input_tokens` counts only
 * the tokens that were neither written to nor read from the cache, so reporting
 * it alone as the prompt size would make every cached turn look nearly free.
 * The two cache fields are declared `number | null`; null means not reported.
 */
function inputUsage(u: Record<string, unknown>): Omit<LLMUsage, 'completion_tokens'> {
  const count = (v: unknown) => (typeof v === 'number' ? v : undefined);
  const read = count(u.cache_read_input_tokens);
  const written = count(u.cache_creation_input_tokens);
  return {
    prompt_tokens: (count(u.input_tokens) ?? 0) + (written ?? 0) + (read ?? 0),
    ...(read === undefined ? {} : { cached_tokens: read }),
    ...(written === undefined ? {} : { cache_write_tokens: written }),
  };
}

function toAnthropicMessages(messages: LLMMessage[]): AnthropicMessage[] {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m): AnthropicMessage => {
      if (m.role === 'tool') {
        return {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content ?? '' }],
        };
      }
      if (m.tool_calls?.length) {
        const content: AnthropicBlock[] = [];
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
  private fetcher: Fetcher;

  constructor(apiKey: string, baseUrl = 'https://api.anthropic.com', fetcher: Fetcher = fetch) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetcher = fetcher;
  }

  // The fields both entry points always send. Note the asymmetry in what each
  // adds on top: `chat` sends `temperature` and no `tools`, `stream` the
  // reverse. That predates this helper and is left as it was.
  private baseBody(messages: LLMMessage[], options?: LLMChatOptions): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: options?.model ?? 'claude-sonnet-4-20250514',
      max_tokens: options?.max_tokens ?? 4096,
      messages: toAnthropicMessages(messages),
    };
    const system = toAnthropicSystem(messages);
    if (system) body.system = system;
    return body;
  }

  // One endpoint, one set of headers — the API version in particular has to stay
  // the same for both calls, so it is written once.
  private post(body: Record<string, unknown>): Promise<Response> {
    return this.fetcher(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
  }

  async chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMResponse> {
    const body = this.baseBody(messages, options);
    if (options?.temperature !== undefined) body.temperature = options.temperature;

    const response = await this.post(body);

    if (!response.ok) {
      const text = await readCappedText(response, MAX_ERROR_BYTES).catch(() => '');
      throw new Error(`Anthropic API error (${response.status}): ${text}`);
    }

    const data = JSON.parse(await readCappedText(response, MAX_RESPONSE_BYTES)) as Record<
      string,
      unknown
    >;
    const content = (data.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const stopReason = data.stop_reason as string | undefined;
    const u = data.usage as Record<string, number>;
    return {
      content,
      finish_reason:
        stopReason === 'max_tokens' ? 'length' : stopReason === 'tool_use' ? 'tool_use' : 'stop',
      usage: { ...inputUsage(u), completion_tokens: u.output_tokens ?? 0 },
    };
  }

  async *stream(messages: LLMMessage[], options?: LLMChatOptions): AsyncIterable<LLMStreamEvent> {
    const body = this.baseBody(messages, options);
    body.messages = withTrailingBreakpoint(body.messages as AnthropicMessage[]);
    body.stream = true;
    if (options?.tools?.length) {
      body.tools = options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const response = await this.post(body);

    if (!response.ok || !response.body) {
      throw new Error(`Anthropic stream error: ${response.status}`);
    }

    // Track tool_use blocks being streamed
    const pendingToolBlocks = new Map<number, { id: string; name: string; input: string }>();

    // Token usage arrives split across two events — input on `message_start`,
    // output on `message_delta` — and is carried to the `done` event so a caller
    // learns what the turn cost. `LLMStreamEvent.usage` has been declared since
    // the interface was written and no provider ever set it, which made every
    // streamed turn (all of them, on both the chat and A2A paths) unmeasurable.
    let usage: LLMUsage | undefined;

    for await (const payload of readSSEData(response.body)) {
      const data = JSON.parse(payload) as Record<string, unknown>;

      if (data.type === 'message_start') {
        const reported = (data.message as Record<string, unknown> | undefined)?.usage as
          | Record<string, number>
          | undefined;
        if (reported) {
          usage = { ...inputUsage(reported), completion_tokens: reported.output_tokens ?? 0 };
        }
      } else if (data.type === 'message_delta') {
        const reported = data.usage as Record<string, number> | undefined;
        if (reported) {
          usage = {
            ...usage,
            prompt_tokens: usage?.prompt_tokens ?? 0,
            completion_tokens: reported.output_tokens ?? usage?.completion_tokens ?? 0,
          };
        }
      } else if (data.type === 'content_block_start') {
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
        yield usage ? { type: 'done', usage } : { type: 'done' };
      }
    }
  }
}
