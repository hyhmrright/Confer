import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAutoClear } from '../../hooks/use-auto-clear.js';
import { usePolicyDraft } from '../../hooks/use-policy-draft.js';
import { useSettingsStore } from '../../stores/settings.js';
import { LoadingDots } from '../LoadingDots.js';
import { SaveButton } from '../SaveButton.js';
import { PolicyEditor } from './PolicyEditor.js';
import { FieldLabel, StatusMsg } from './SettingsShared.js';

export function PolicyTab() {
  const { t } = useTranslation();
  const agent = useSettingsStore((s) => s.agent);
  const loading = useSettingsStore((s) => s.loading);
  const saving = useSettingsStore((s) => s.saving);
  const error = useSettingsStore((s) => s.error);
  const success = useSettingsStore((s) => s.success);
  const loadAgent = useSettingsStore((s) => s.loadAgent);
  const updatePolicies = useSettingsStore((s) => s.updatePolicies);
  const clearMessages = useSettingsStore((s) => s.clearMessages);
  const policy = usePolicyDraft(agent?.policies_json);

  useEffect(() => {
    loadAgent();
  }, [loadAgent]);

  useAutoClear(success, error, clearMessages);

  const handleSave = () => updatePolicies(policy.draft());

  if (loading) {
    return (
      <div className="flex justify-center pt-12">
        <LoadingDots />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <FieldLabel htmlFor="agent-default-policy">{t('settings.agentDefaultPolicy')}</FieldLabel>
        <p className="text-xs text-ink-muted mb-2">{t('settings.agentDefaultPolicyHint')}</p>
        <PolicyEditor
          id="agent-default-policy"
          decision={policy.decision}
          onChange={policy.setDecision}
          inheritLabel={null}
          rules={policy.rules}
          onRemoveRule={policy.removeRule}
        />
      </div>

      <StatusMsg error={error} success={success} />

      <SaveButton onClick={handleSave} saving={saving} />
    </div>
  );
}
