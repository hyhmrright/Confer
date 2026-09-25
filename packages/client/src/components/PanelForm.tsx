import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DISABLED_FILLED } from '../lib/styles.js';

// The inline "new item" form a sidebar panel drops below its header: the
// caller's fields, an optional error, then Cancel and the submit button.
export function PanelForm({
  children,
  error,
  onCancel,
  onSubmit,
  submitDisabled,
  submitLabel,
}: {
  children: ReactNode;
  error?: string | null;
  onCancel: () => void;
  onSubmit: () => void;
  submitDisabled: boolean;
  submitLabel: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="px-3 py-3 border-b border-dark-border space-y-2 shrink-0 bg-dark-card/50">
      {children}
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-ink-muted hover:text-ink-secondary transition-colors"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitDisabled}
          className={`px-3 py-1.5 text-xs bg-primary-600 text-white rounded-lg
            hover:bg-primary-500 ${DISABLED_FILLED} transition-colors`}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
