import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mergePolicyDefault } from '../lib/policy.js';
import { useContactsStore } from '../stores/contacts.js';
import { Bot } from './Icons.js';
import { Modal } from './Modal.js';
import { SaveButton } from './SaveButton.js';
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
  const selectedContact = useContactsStore((s) => s.selectedContact);
  const loading = useContactsStore((s) => s.loading);
  const saving = useContactsStore((s) => s.saving);
  const error = useContactsStore((s) => s.error);
  const success = useContactsStore((s) => s.success);
  const closeDetail = useContactsStore((s) => s.closeDetail);
  const setContactPolicy = useContactsStore((s) => s.setContactPolicy);
  const clearDetailMessages = useContactsStore((s) => s.clearDetailMessages);
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
    <Modal
      title={t('contacts.detailTitle')}
      onClose={closeDetail}
      panelClassName="max-h-[85vh] flex flex-col"
    >
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
          <FieldLabel htmlFor="contact-policy-default">{t('policy.default')}</FieldLabel>
          <p className="text-xs text-ink-muted mb-2">{t('policy.defaultHint')}</p>
          {loading ? (
            <p className="text-xs text-ink-muted">{t('common.loading')}</p>
          ) : (
            <PolicyEditor
              id="contact-policy-default"
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
        <SaveButton onClick={handleSave} saving={saving} label={t('contacts.savePolicy')} />
      </div>
    </Modal>
  );
}
