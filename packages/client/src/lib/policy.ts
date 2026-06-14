import type { PolicyOverrides } from '@confer/shared';
import type { TranslationKey } from '../i18n/index.js';

// The engine-vocabulary decisions the runtime actually evaluates
// (`agent-runtime/src/policy/engine.ts`). This is NOT the AgentFacts
// `auto/ask/deny` advertisement vocabulary — do not bridge the two.
export type PolicyDecision = NonNullable<PolicyOverrides['default']>;

export const POLICY_DECISIONS: readonly PolicyDecision[] = ['allow', 'ask_user', 'deny'];

// i18n label key for each engine decision, reused by the per-contact editor
// (ContactDetail) and the agent-default editor (PolicyTab).
export const POLICY_DECISION_LABEL_KEY: Record<PolicyDecision, TranslationKey> = {
  allow: 'policy.decisionAllow',
  ask_user: 'policy.decisionAsk',
  deny: 'policy.decisionDeny',
};

// Sentinel value for the "inherit / use agent default" <select> option. An
// empty `default` (omitted from the override object) means "fall through to the
// agent-level default" per `mergePolicyConfig` identity semantics.
export const POLICY_INHERIT = '' as const;

// Map a <select> value back to the override `default` field: the inherit
// sentinel omits `default` (undefined), every other value passes through.
// Module-private — only `mergePolicyDefault` consumes it.
function decisionFromSelect(value: string): PolicyDecision | undefined {
  return value === POLICY_INHERIT ? undefined : (value as PolicyDecision);
}

// Whole-object replace builder for both editors: preserve any existing `rules`
// on `base`, and set `default` from the selected value — omitting the key
// entirely when the selection is "inherit" (so an empty `{}` means "use the
// agent default"). Avoids the `delete` operator (lint/performance/noDelete).
export function mergePolicyDefault(
  base: PolicyOverrides | undefined,
  selectValue: string,
): PolicyOverrides {
  const decision = decisionFromSelect(selectValue);
  const next: PolicyOverrides = {};
  if (base?.rules !== undefined) next.rules = base.rules;
  if (decision !== undefined) next.default = decision;
  return next;
}
