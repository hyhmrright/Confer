import { Shield } from './Icons.js';

/*
  What a decision card becomes once it has been decided: a one-line record of
  what was asked and what you answered.

  Shared by the two consent surfaces — inbound permission requests and outbound
  errand cards. They are deliberately different while pending (different
  semantics, different options), but a settled one is the same object in both
  cases, and they had already drifted into two copies of the same seven lines.

  Both copies also dimmed themselves with `opacity-60` over the whole card,
  which took the outcome word — the one thing worth reading later — under the
  contrast floor. Settled state is carried by dropping the risk tint and
  demoting the type instead.
*/
export function DecisionRecord({
  summary,
  outcome,
  tone,
}: {
  summary: string;
  outcome: string;
  tone: 'accepted' | 'refused';
}) {
  return (
    <div className="rounded-lg border border-dark-border bg-dark-card px-4 py-3">
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 shrink-0 text-ink-muted" />
        <span className="text-sm text-ink-secondary">{summary}</span>
        <span
          className={`text-sm font-medium ms-auto shrink-0 ${
            tone === 'accepted' ? 'text-green-400' : 'text-red-400'
          }`}
        >
          {outcome}
        </span>
      </div>
    </div>
  );
}
