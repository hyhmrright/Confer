import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mergePolicyDefault } from '../../lib/policy.js';
import { useSettingsStore } from '../../stores/settings.js';
import { PolicyEditor } from './PolicyEditor.js';
import { FieldLabel, StatusMsg } from './SettingsShared.js';

export function PolicyTab() {
  const { t } = useTranslation();
  const { agent, loading, saving, error, success, loadAgent, updatePolicies, clearMessages } =
    useSettingsStore();
  const [decision, setDecision] = useState<string>('');

  useEffect(() => {
    loadAgent();
  }, [loadAgent]);

  useEffect(() => {
    setDecision(agent?.policies_json?.default ?? '');
  }, [agent]);

  useEffect(() => {
    if (success || error) {
      const timer = setTimeout(clearMessages, 3000);
      return () => clearTimeout(timer);
    }
  }, [success, error, clearMessages]);

  const handleSave = () => {
    // Whole-object replace: preserve any existing rules, only swap `default`.
    updatePolicies(mergePolicyDefault(agent?.policies_json, decision));
  };

  if (loading) {
    return (
      <div className="flex justify-center pt-12">
        <div className="flex gap-1.5">
          {[0, 150, 300].map((d) => (
            <span
              key={d}
              className="w-1.5 h-1.5 rounded-full bg-dark-border animate-bounce"
              style={{ animationDelay: `${d}ms` }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <FieldLabel>{t('settings.agentDefaultPolicy')}</FieldLabel>
        <p className="text-xs text-ink-muted mb-2">{t('settings.agentDefaultPolicyHint')}</p>
        <PolicyEditor
          decision={decision}
          onChange={setDecision}
          inheritLabel={null}
          rules={agent?.policies_json?.rules}
        />
      </div>

      <StatusMsg error={error} success={success} />

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="px-5 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-500 disabled:opacity-40 transition-colors"
      >
        {saving ? t('common.saving') : t('common.save')}
      </button>
    </div>
  );
}
