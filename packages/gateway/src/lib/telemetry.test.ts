import { afterEach, describe, expect, test } from 'bun:test';
import { type AgentTurnRecord, recordAgentTurn } from './telemetry.js';

// This line is the only record an instance keeps of what its agent did and what
// it cost. It is grepped by operators and parsed by nobody, so what matters is
// that every field is present, that absence never masquerades as zero, and that
// no PII gets in.

const original = console.log;
let lines: string[] = [];

function capture(): void {
  lines = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.join(' '));
  };
}

afterEach(() => {
  console.log = original;
});

const base: AgentTurnRecord = {
  userId: '01ABCDEF',
  audience: 'owner',
  provider: 'anthropic',
  model: 'claude-opus-5',
  durationMs: 2345,
  rounds: 2,
  usage: { prompt_tokens: 1200, completion_tokens: 42 },
  recall: '3@0.62',
  kb: 'searched',
  citations: 2,
  tools: 1,
};

function record(overrides: Partial<AgentTurnRecord> = {}): string {
  capture();
  recordAgentTurn({ ...base, ...overrides });
  return lines.join('\n');
}

describe('recordAgentTurn', () => {
  test('emits one line carrying grounding and cost together', () => {
    const line = record();

    expect(lines).toHaveLength(1);
    expect(line).toContain('user=01ABCDEF');
    expect(line).toContain('audience=owner');
    expect(line).toContain('gen_ai.usage.input_tokens=1200');
    expect(line).toContain('gen_ai.usage.output_tokens=42');
    expect(line).toContain('duration_ms=2345');
    expect(line).toContain('rounds=2');
    expect(line).toContain('recall=3@0.62');
    expect(line).toContain('kb=searched');
    expect(line).toContain('cites=2');
    expect(line).toContain('tools=1');
  });

  test('uses the OpenTelemetry GenAI attribute names', () => {
    // Not cosmetic: these are the names a collector already understands, so
    // wiring one up later is configuration rather than a rewrite of this file.
    const line = record();
    expect(line).toContain('gen_ai.operation.name=chat');
    expect(line).toContain('gen_ai.provider.name=anthropic');
    expect(line).toContain('gen_ai.request.model=claude-opus-5');
  });

  test('reports unmeasured usage as unreported, never as zero', () => {
    // A vendor that volunteers no usage is not a free turn. Logging `0` would
    // make an unmeasured instance look like an idle one.
    const line = record({ usage: undefined });
    expect(line).toContain('gen_ai.usage=unreported');
    expect(line).not.toContain('input_tokens=0');
  });

  test('still reports a genuine zero as a number', () => {
    const line = record({ usage: { prompt_tokens: 0, completion_tokens: 0 } });
    expect(line).toContain('gen_ai.usage.input_tokens=0');
    expect(line).not.toContain('unreported');
  });

  test('names the provider default when the owner chose no model', () => {
    const line = record({ model: undefined });
    expect(line).toContain('gen_ai.request.model=default');
  });

  test('carries the error type when the turn threw', () => {
    const line = record({ errorType: 'TypeError' });
    expect(line).toContain('error.type=TypeError');
  });

  test('omits error.type on a turn that succeeded', () => {
    expect(record()).not.toContain('error.type');
  });

  test('distinguishes a peer turn from the owner own', () => {
    // The two run with different capability sets, and a surprising cost on a
    // peer turn is a different problem from one on the owner's own.
    expect(record({ audience: 'peer' })).toContain('audience=peer');
  });

  test.each([
    ['withheld', 'a peer turn, where recall is a deliberate boundary'],
    ['off', 'no embedding key — a misconfiguration, not a boundary'],
    ['failed', 'recall threw'],
    ['0', 'recall ran and matched nothing'],
  ])('passes through recall state %s (%s)', (state) => {
    expect(record({ recall: state })).toContain(`recall=${state}`);
  });
});
