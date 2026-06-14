import type { PolicyOverrides } from '@confer/shared';
import { useTranslation } from 'react-i18next';
import { POLICY_DECISIONS, POLICY_DECISION_LABEL_KEY, POLICY_INHERIT } from '../../lib/policy.js';
import { SELECT_FIELD_CLS } from '../../lib/styles.js';

type PolicyRule = NonNullable<PolicyOverrides['rules']>[number];

// Shared decision selector + read-only existing-rules display, reused by the
// agent-default editor (PolicyTab) and the per-contact editor (ContactDetail).
// `inheritLabel` is null for the agent default (it has nothing to inherit) and a
// label string for a per-contact override (the "use agent default" option, which
// maps to omitting `default`).
//
// TODO: rules are rendered read-only in this MVP. A full visual rules editor
// (add/remove per-action/per-peer decisions) is deferred — see plan §4.
export function PolicyEditor({
  decision,
  onChange,
  inheritLabel,
  rules,
}: {
  decision: string;
  onChange: (value: string) => void;
  inheritLabel: string | null;
  rules?: PolicyRule[];
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <select
        value={decision}
        onChange={(e) => onChange(e.target.value)}
        className={SELECT_FIELD_CLS}
      >
        {inheritLabel !== null && <option value={POLICY_INHERIT}>{inheritLabel}</option>}
        {POLICY_DECISIONS.map((d) => (
          <option key={d} value={d}>
            {t(POLICY_DECISION_LABEL_KEY[d])}
          </option>
        ))}
      </select>

      <div>
        <span className="block text-xs font-medium text-ink-secondary mb-1">
          {t('policy.rulesHeading')}
        </span>
        <p className="text-[11px] text-ink-muted mb-2">{t('policy.rulesReadonlyHint')}</p>
        {rules && rules.length > 0 ? (
          <ul className="space-y-1.5">
            {rules.map((rule, i) => (
              <li
                key={`${rule.action}-${rule.peer_did ?? ''}-${i}`}
                className="flex items-center gap-2 text-xs px-3 py-2 bg-dark-input border border-dark-border rounded-lg"
              >
                <span className="font-mono text-ink-secondary truncate">{rule.action}</span>
                {rule.peer_did && (
                  <span className="font-mono text-ink-muted truncate">{rule.peer_did}</span>
                )}
                <span className="ml-auto text-ink-primary shrink-0">
                  {t(POLICY_DECISION_LABEL_KEY[rule.decision])}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-muted">{t('policy.noRules')}</p>
        )}
      </div>
    </div>
  );
}
