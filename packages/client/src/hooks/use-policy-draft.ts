import type { PolicyOverrides } from '@confer/shared';
import { useEffect, useState } from 'react';
import { mergePolicyDefault } from '../lib/policy.js';

// The unsaved edit of a policy shared by both editors (agent default and
// per-contact): the selected default plus the rules the owner has not removed.
// Both reset whenever the saved policy changes, and `draft()` is the
// whole-object body to save.
export function usePolicyDraft(saved: PolicyOverrides | undefined) {
  const [decision, setDecision] = useState<string>('');
  const [rules, setRules] = useState(saved?.rules);

  useEffect(() => {
    setDecision(saved?.default ?? '');
    setRules(saved?.rules);
  }, [saved]);

  const removeRule = (index: number) => setRules((r) => r?.filter((_, i) => i !== index));

  return {
    decision,
    setDecision,
    rules,
    removeRule,
    draft: () => mergePolicyDefault({ rules }, decision),
  };
}
