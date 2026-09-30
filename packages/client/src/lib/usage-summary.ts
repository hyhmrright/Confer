/** One group from `GET /usage`: a provider × model × audience for the month. */
export interface UsageRow {
  provider: string;
  /** Null when the owner named no model and the provider's default ran. */
  model: string | null;
  audience: 'owner' | 'peer';
  turns: number;
  unreported: number;
  failed: number;
  /** Null when no turn in the group reported usage. */
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
}

export interface UsageModelLine {
  provider: string;
  model: string | null;
  turns: number;
  /** Null when no turn on this model reported usage: unknown, not zero. */
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface UsageSummary {
  turns: number;
  peerTurns: number;
  unreported: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  /**
   * Share of input tokens served from the prompt cache, or null when no vendor
   * said anything about caching — which is not the same as a 0% hit rate. Only
   * groups that reported cache hits count towards the denominator, so a vendor
   * silent about caching does not dilute one that reports it.
   */
  cacheHitRate: number | null;
  byModel: UsageModelLine[];
}

function addReported(total: number | null, value: number | null): number | null {
  return value === null ? total : (total ?? 0) + value;
}

// The server splits by audience so the panel can say how much of the bill
// answered contacts; the per-model table folds that split back together.
export function summarizeUsage(rows: UsageRow[]): UsageSummary {
  const byModel = new Map<string, UsageModelLine>();
  let cacheRead: number | null = null;
  let cacheableInput = 0;
  const summary: UsageSummary = {
    turns: 0,
    peerTurns: 0,
    unreported: 0,
    failed: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheHitRate: null,
    byModel: [],
  };

  for (const row of rows) {
    summary.turns += row.turns;
    if (row.audience === 'peer') summary.peerTurns += row.turns;
    summary.unreported += row.unreported;
    summary.failed += row.failed;
    summary.inputTokens += row.input_tokens ?? 0;
    summary.outputTokens += row.output_tokens ?? 0;
    if (row.cache_read_tokens !== null) {
      cacheRead = (cacheRead ?? 0) + row.cache_read_tokens;
      cacheableInput += row.input_tokens ?? 0;
    }

    const key = `${row.provider}\u0000${row.model ?? ''}`;
    const line = byModel.get(key) ?? {
      provider: row.provider,
      model: row.model,
      turns: 0,
      inputTokens: null,
      outputTokens: null,
    };
    line.turns += row.turns;
    line.inputTokens = addReported(line.inputTokens, row.input_tokens);
    line.outputTokens = addReported(line.outputTokens, row.output_tokens);
    byModel.set(key, line);
  }

  if (cacheRead !== null && cacheableInput > 0) {
    summary.cacheHitRate = cacheRead / cacheableInput;
  }
  const volume = (line: UsageModelLine) => (line.inputTokens ?? 0) + (line.outputTokens ?? 0);
  summary.byModel = [...byModel.values()].sort((a, b) => volume(b) - volume(a));
  return summary;
}

/** `YYYY-MM` shifted by whole months, in UTC like the server's month bounds. */
export function shiftMonth(month: string, by: number): string {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by));
  return date.toISOString().slice(0, 7);
}

export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}
