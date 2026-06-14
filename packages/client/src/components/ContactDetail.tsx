import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mergePolicyDefault } from '../lib/policy.js';
import { useContactsStore } from '../stores/contacts.js';
import { Bot, X } from './Icons.js';
import { PolicyEditor } from './settings/PolicyEditor.js';
import { FieldLabel, StatusMsg } from './settings/SettingsShared.js';

// Read-only metadata row (alias / tags / pinned / muted display).
function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <p className="text-sm text-ink-primary">{value}</p>
    </div>
  );
}

export function ContactDetail() {
  const { t } = useTranslation();
  const {
    selectedContact,
    loading,
    saving,
    error,
    success,
    closeDetail,
    setContactPolicy,
    clearDetailMessages,
  } = useContactsStore();
  const [decision, setDecision] = useState<string>('');

  const overrides = selectedContact?.policy_overrides_json;

  useEffect(() => {
    setDecision(overrides?.default ?? '');
  }, [overrides]);

  useEffect(() => {
    if (success || error) {
      const timer = setTimeout(clearDetailMessages, 3000);
      return () => clearTimeout(timer);
    }
  }, [success, error, clearDetailMessages]);

  if (!selectedContact) return null;

  const { peer, alias, tags, pinned, muted } = selectedContact;
  const yesNo = (value: boolean | undefined) => (value ? t('contacts.yes') : t('contacts.no'));

  const handleSave = () => {
    // Whole-object replace: preserve any existing rules, only swap `default`.
    setContactPolicy(selectedContact.id, mergePolicyDefault(overrides, decision));
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-dark-panel border border-dark-border rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[85vh] flex flex-col overflow-hidden animate-fade-in">
        <div className="flex justify-between items-center px-6 py-4 border-b border-dark-border shrink-0">
          <h2 className="text-base font-semibold text-ink-primary">{t('contacts.detailTitle')}</h2>
          <button
            type="button"
            onClick={closeDetail}
            aria-label={t('contacts.close')}
            className="p-1.5 text-ink-muted hover:text-ink-secondary hover:bg-dark-hover rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-dark-border flex items-center justify-center shrink-0">
              <Bot className="w-5 h-5 text-ink-muted" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink-primary truncate">
                {alias ?? peer.name ?? t('contacts.unnamed')}
              </div>
              <div className="text-xs text-ink-muted truncate">{peer.did}</div>
              {peer.organization && (
                <div className="text-xs text-ink-muted truncate">{peer.organization}</div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <MetaRow label={t('contacts.alias')} value={alias ?? '—'} />
            <MetaRow
              label={t('contacts.tags')}
              value={tags && tags.length > 0 ? tags.join(', ') : t('contacts.noTags')}
            />
            <MetaRow label={t('contacts.pinned')} value={yesNo(pinned)} />
            <MetaRow label={t('contacts.muted')} value={yesNo(muted)} />
          </div>

          <div>
            <FieldLabel>{t('policy.default')}</FieldLabel>
            <p className="text-xs text-ink-muted mb-2">{t('policy.defaultHint')}</p>
            {loading ? (
              <p className="text-xs text-ink-muted">{t('common.loading')}</p>
            ) : (
              <PolicyEditor
                decision={decision}
                onChange={setDecision}
                inheritLabel={t('policy.inherit')}
                rules={overrides?.rules}
              />
            )}
          </div>

          <StatusMsg error={error} success={success} />
        </div>

        <div className="px-6 py-4 border-t border-dark-border shrink-0">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-500 disabled:opacity-40 transition-colors"
          >
            {saving ? t('common.saving') : t('contacts.savePolicy')}
          </button>
        </div>
      </div>
    </div>
  );
}
