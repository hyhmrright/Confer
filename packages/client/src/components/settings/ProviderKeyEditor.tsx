import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Key } from '../Icons.js';

// One provider key row: shows the provider name + configured/extra badges and an
// inline edit form. Shared by the LLM-provider and tool-provider lists in the
// keys tab (the two used to be near-identical copies). The caller owns the
// edit/save/remove behavior and the input's type/placeholder so the LLM vs tool
// differences stay at the call site.
export function ProviderKeyEditor({
  name,
  configured,
  editing,
  saving,
  inputType,
  inputPlaceholder,
  keyValue,
  badge,
  description,
  hint,
  onEdit,
  onRemove,
  onChange,
  onSave,
  onCancel,
}: {
  name: ReactNode;
  configured: boolean;
  editing: boolean;
  saving: boolean;
  inputType: 'text' | 'password';
  inputPlaceholder: string;
  keyValue: string;
  badge?: ReactNode;
  description?: ReactNode;
  hint?: ReactNode;
  onEdit: () => void;
  onRemove: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="border border-dark-border rounded-xl p-3.5 bg-dark-card">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Key className="w-3.5 h-3.5 text-ink-muted" />
          {description ? (
            <div>
              <span className="text-sm font-medium text-ink-primary">{name}</span>
              {badge}
              <p className="text-[11px] text-ink-muted mt-0.5">{description}</p>
            </div>
          ) : (
            <>
              <span className="text-sm font-medium text-ink-primary">{name}</span>
              {badge}
              {hint}
            </>
          )}
        </div>
        <div className={`flex gap-3 ${description ? 'shrink-0 ml-3' : ''}`}>
          {!editing && (
            <button
              type="button"
              onClick={onEdit}
              className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
            >
              {configured ? t('common.update') : t('common.configure')}
            </button>
          )}
          {configured && !editing && (
            <button
              type="button"
              onClick={onRemove}
              disabled={saving}
              className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-40"
            >
              {t('common.remove')}
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-3 flex gap-2">
          <input
            type={inputType}
            value={keyValue}
            onChange={(e) => onChange(e.target.value)}
            placeholder={inputPlaceholder}
            className="flex-1 px-3 py-1.5 bg-dark-input border border-dark-border rounded-lg text-xs font-mono text-ink-primary placeholder:text-ink-muted focus:outline-none focus:border-primary-600/40 transition-colors"
          />
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !keyValue.trim()}
            className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs hover:bg-primary-500 disabled:opacity-40 transition-colors"
          >
            {t('common.save')}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 border border-dark-border rounded-lg text-xs text-ink-muted hover:text-ink-secondary transition-colors"
          >
            {t('common.cancel')}
          </button>
        </div>
      )}
    </div>
  );
}
