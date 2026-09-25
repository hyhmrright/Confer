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

function toOpenAIMessage(m: LLMMessage): Record<string, unknown> {
  if (m.role === 'tool') {
    return { role: 'tool', content: m.content ?? '', tool_call_id: m.tool_call_id };
  }
  if (m.tool_calls) {
    return { role: 'assistant', content: m.content, tool_calls: m.tool_calls };
  }
  return { role: m.role, content: m.content ?? '' };
}

/**
 * Several system messages are the caller marking where the stable part of the
 * prompt ends, for Anthropic's explicit cache breakpoints (see anthropic.ts).
 * OpenAI-shape vendors cache a matching prefix on their own with no marker, and
 * not every one of them — nor every local model's chat template — honours more
 * than one system message, so they still go out as the single one they were.
 */
function foldSystemMessages(messages: LLMMessage[]): LLMMessage[] {
  const system = messages
    .filter((m) => m.role === 'system' && m.content)
    .map((m) => m.content)
    .join('\n');
  const rest = messages.filter((m) => m.role !== 'system');
  return system ? [{ role: 'system', content: system }, ...rest] : rest;
}

/**
 * Usage as reported. Cache hits are already inside `prompt_tokens` here, unlike
 * Anthropic's; the hit count sits in OpenAI's `prompt_tokens_details`, in
 * DeepSeek's `prompt_cache_hit_tokens`, or at the top level (Moonshot). None of
 * them a number — absent or null — means not reported.
 */
function toUsage(u: Record<string, unknown>): LLMUsage {
  const count = (v: unknown) => (typeof v === 'number' ? v : undefined);
  const details = u.prompt_tokens_details as Record<string, unknown> | null | undefined;
  const cached =
    count(details?.cached_tokens) ?? count(u.prompt_cache_hit_tokens) ?? count(u.cached_tokens);
  return {
    prompt_tokens: count(u.prompt_tokens) ?? 0,
    completion_tokens: count(u.completion_tokens) ?? 0,
    ...(cached === undefined ? {} : { cached_tokens: cached }),
  };
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;
  private completionsPath: string;
  private fetcher: Fetcher;

  constructor(
    name: string,
    apiKey: string,
    baseUrl: string,
    defaultModel: string,
    completionsPath = '/v1/chat/completions',
    fetcher: Fetcher = fetch,
  ) {
    this.name = name;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.defaultModel = defaultModel;
    this.completionsPath = completionsPath;
    this.fetcher = fetcher;
  }

  // Catalogue entries only carry a default model where we can name a current
  // one; for the rest the owner picks from the vendor's own list. Say so here,
  // rather than posting `model: ""` and relaying whatever 400 comes back.
  private resolveModel(options?: LLMChatOptions): string {
    const model = options?.model || this.defaultModel;
    if (!model) {
      throw new Error(`${this.name}: no model selected — choose one in agent settings`);
    }
    return model;
  }

  // The fields both entry points always send. Note the asymmetry in what each
  // adds on top: only `stream` sends `tools`. That predates this helper and is
  // left as it was.
  private baseBody(messages: LLMMessage[], options?: LLMChatOptions): Record<string, unknown> {
    return {
      model: this.resolveModel(options),
      messages: foldSystemMessages(messages).map(toOpenAIMessage),
      temperature: options?.temperature,
      max_tokens: options?.max_tokens ?? 4096,
    };
  }

  // One address, one set of headers. The vendor's path is configurable, so the
  // two calls must not each build it.
  private post(body: Record<string, unknown>): Promise<Response> {
    return this.fetcher(`${this.baseUrl}${this.completionsPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  }

  async chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMResponse> {
    const response = await this.post(this.baseBody(messages, options));

    if (!response.ok) {
      const text = await readCappedText(response, MAX_ERROR_BYTES).catch(() => '');
      throw new Error(`${this.name} API error (${response.status}): ${text}`);
    }

    const data = JSON.parse(await readCappedText(response, MAX_RESPONSE_BYTES)) as Record<
      string,
      unknown
    >;
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
      usage: toUsage(data.usage as Record<string, unknown>),
    };
  }

  async *stream(messages: LLMMessage[], options?: LLMChatOptions): AsyncIterable<LLMStreamEvent> {
    const body = this.baseBody(messages, options);
    body.stream = true;
    if (options?.tools?.length) {
      body.tools = options.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = 'auto';
    }

    const response = await this.post(body);

    if (!response.ok || !response.body) {
      throw new Error(`${this.name} stream error: ${response.status}`);
    }

    const pendingCalls = new Map<number, { id: string; name: string; arguments: string }>();

    // Usage is read when the vendor volunteers it, and never asked for. OpenAI
    // itself gates it behind `stream_options: {include_usage: true}`, but this
    // one code path serves all eighteen entries in the catalogue and an unknown
    // body field is a 400 at some of them — and which ones is exactly the kind
    // of per-vendor claim this codebase got burned making before. A vendor that
    // stays silent is reported as UNMEASURED rather than as zero tokens.
    let usage: LLMUsage | undefined;

    for await (const payload of readSSEData(response.body)) {
      const chunk = payload.trim();
      if (chunk === '[DONE]') {
        for (const [, tc] of pendingCalls) {
          yield {
            type: 'tool_call',
            tool_call: { id: tc.id, name: tc.name, arguments: tc.arguments },
          };
        }
        yield usage ? { type: 'done', usage } : { type: 'done' };
        return;
      }

      const data = JSON.parse(chunk) as Record<string, unknown>;
      const reported = data.usage as Record<string, unknown> | null | undefined;
      if (reported) usage = toUsage(reported);
      // The chunk carrying usage has an EMPTY choices array, and some vendors
      // omit the field entirely on it — indexing into it unguarded would throw
      // and take down a turn that had already produced its whole answer.
      const choices = (data.choices as Array<Record<string, unknown>> | undefined) ?? [];
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
 * Factory for an OpenAI-compatible endpoint not in the shared catalogue.
 * Catalogued vendors go through `createProvider`, which reads their base URL,
 * path and default model from the one list; this stays for callers wiring an
 * endpoint of their own. Defaults to OpenAI's own address and path.
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
    opts.completionsPath,
  );
}
