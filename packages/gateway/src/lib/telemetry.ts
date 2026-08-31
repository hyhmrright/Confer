/**
 * What one agent turn was grounded in, and what it cost.
 *
 * Two separate needs, deliberately on ONE line rather than two. The grounding
 * half has no other way to be noticed: recall returning nothing has three causes
 * that all present as an empty prompt fragment — nothing stored, nothing above
 * the score floor, or rows that were never indexed — and the last one hid for
 * months. And the knowledge-base instruction *mandates* a search before
 * answering, yet a model that ignores it produces a fluent answer from its own
 * priors that reads exactly like a grounded one.
 *
 * The cost half was simply unavailable: `LLMStreamEvent.usage` was declared when
 * the provider interface was written and neither provider ever set it, so every
 * streamed turn — which is all of them, on both the chat and the A2A path — had
 * its token count thrown away. An owner could not answer "what is this
 * spending?" from anything the instance recorded.
 *
 * Field names are the OpenTelemetry GenAI semantic conventions (`gen_ai.*`,
 * `error.type`), so the record is already in the vocabulary a collector expects
 * and `recordAgentTurn` is the single seam an exporter would attach to. No OTel
 * SDK is wired up: nothing in this stack runs a collector, and a dependency that
 * exports into the void is the mistake this repo already made once with Redis
 * and NATS.
 *
 * PII stays out. Counts, scores, durations and identifiers only — never memory
 * text, message content, or the model's answer.
 */

export interface AgentTurnRecord {
  /** The turn's owner. Never the peer, even when a peer asked the question. */
  userId: string;
  /** Which capability set the turn ran with. A peer turn reaches far less data. */
  audience: 'owner' | 'peer';
  provider: string;
  /**
   * Undefined when the owner never named one and the provider's own default is
   * in use — which for a local runtime is a different model per install, so
   * `default` is the honest value rather than a guess at what actually ran.
   */
  model?: string;
  /** Wall-clock across the whole tool loop, not one model call. */
  durationMs: number;
  /** Model calls made — one per tool round, so >1 means tools were used. */
  rounds: number;
  /**
   * Undefined when the vendor reported nothing, which is NOT the same as zero
   * and must not be logged as if it were: OpenAI gates streamed usage behind an
   * opt-in this code deliberately does not send.
   */
  usage?: { prompt_tokens: number; completion_tokens: number };
  /** Long-term memory recall: `withheld` / `off` / `failed` / `0` / `3@0.62`. */
  recall: string;
  /** Knowledge base: `none` / `searched` / `unsearched`. */
  kb: string;
  citations: number;
  tools: number;
  /** Present only when the turn threw; the error's constructor name. */
  errorType?: string;
}

function usageFields(usage: AgentTurnRecord['usage']): string {
  if (!usage) return ' gen_ai.usage=unreported';
  return (
    ` gen_ai.usage.input_tokens=${usage.prompt_tokens}` +
    ` gen_ai.usage.output_tokens=${usage.completion_tokens}`
  );
}

export function recordAgentTurn(record: AgentTurnRecord): void {
  console.log(
    `agent turn user=${record.userId}` +
      ` audience=${record.audience}` +
      ' gen_ai.operation.name=chat' +
      ` gen_ai.provider.name=${record.provider}` +
      ` gen_ai.request.model=${record.model ?? 'default'}` +
      usageFields(record.usage) +
      ` duration_ms=${record.durationMs}` +
      ` rounds=${record.rounds}` +
      ` recall=${record.recall}` +
      // `kb=searched` says the model obeyed the instruction, not that anything
      // came back: a search that matched nothing, and one that threw and was
      // handed to the model as error text, both still count as searched.
      ` kb=${record.kb}` +
      ` cites=${record.citations}` +
      ` tools=${record.tools}` +
      (record.errorType ? ` error.type=${record.errorType}` : ''),
  );
}
