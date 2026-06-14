import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { dateLocale } from '../i18n/index.js';
import { usePermissionsStore } from '../stores/permissions.js';
import { Shield } from './Icons.js';

// Format a nullable ISO `decided_at` into a locale-aware date-time string, or a
// dash when the backend returned null.
function formatDecidedAt(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(dateLocale());
}

export function PermissionHistory() {
  const { t } = useTranslation();
  const { history, historyError, loadHistory } = usePermissionsStore();

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  if (historyError) {
    return (
      <div className="flex flex-col items-center justify-center text-red-400 py-12">
        <Shield className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-sm">{historyError}</p>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-ink-muted py-12">
        <Shield className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-sm">{t('history.empty')}</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {history.map((entry) => {
        // Decided rows are `allow_once`/`allow_always` or `deny`/`deny_always`.
        const allowed = entry.decision?.startsWith('allow') ?? false;
        const decisionColor = allowed ? 'text-green-400' : 'text-red-400';
        const decisionLabel = allowed ? t('history.decisionAllow') : t('history.decisionDeny');
        return (
          <li
            key={entry.id}
            className="flex items-center gap-3 px-4 py-3 bg-dark-card border border-dark-border rounded-lg"
          >
            <Shield className="w-4 h-4 text-ink-muted shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-ink-primary font-mono truncate">{entry.action}</div>
              <div className="text-xs text-ink-muted">
                {t('history.decidedAt')}: {formatDecidedAt(entry.decided_at)}
              </div>
            </div>
            <span className={`text-sm font-medium shrink-0 ${decisionColor}`}>{decisionLabel}</span>
          </li>
        );
      })}
    </ul>
  );
}
