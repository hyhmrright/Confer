import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TranslationKey } from '../i18n/index.js';
import { api } from '../lib/api.js';
import { Shield } from './Icons.js';

interface PermissionRequest {
  id: string;
  level: string;
  action: string;
  scope: Record<string, unknown>;
  description: string;
  requested_at: string;
}

const levelColor: Record<string, string> = {
  L1: 'border-green-800/40 bg-green-900/20',
  L2: 'border-yellow-800/40 bg-yellow-900/20',
  L3: 'border-red-800/40 bg-red-900/20',
};

const levelLabelKey: Record<string, TranslationKey> = {
  L1: 'permission.levelLow',
  L2: 'permission.levelMedium',
  L3: 'permission.levelHigh',
};

export function PermissionCard({
  request,
  onDecided,
}: {
  request: PermissionRequest;
  onDecided?: () => void;
}) {
  const { t } = useTranslation();
  const [deciding, setDeciding] = useState(false);
  const [decided, setDecided] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDecide = async (decision: string) => {
    setDeciding(true);
    setError(null);
    try {
      await api.post(`/permissions/${request.id}/decide`, {
        decision,
        scope: 'peer_action',
      });
      setDecided(decision);
      onDecided?.();
    } catch {
      setDeciding(false);
      setError(t('permission.decideError'));
    }
  };

  const borderClass = levelColor[request.level] ?? 'border-dark-border bg-dark-card';

  if (decided) {
    const label = decided.includes('allow') ? t('permission.allowed') : t('permission.denied');
    const color = decided.includes('allow') ? 'text-green-400' : 'text-red-400';
    return (
      <div className={`rounded-lg border-2 px-4 py-3 ${borderClass} opacity-60`}>
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-ink-muted" />
          <span className="text-sm text-ink-secondary">{request.description}</span>
          <span className={`text-sm font-medium ml-auto ${color}`}>{label}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border-2 px-4 py-3 animate-fade-in ${borderClass}`}>
      <div className="flex items-start gap-2 mb-2">
        <Shield className="w-4 h-4 mt-0.5 text-ink-secondary" />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-ink-secondary">{request.level}</span>
            <span className="text-xs text-ink-muted">
              {levelLabelKey[request.level] ? t(levelLabelKey[request.level]) : request.level}
            </span>
          </div>
          <p className="text-sm text-ink-primary">{request.description}</p>
        </div>
      </div>
      {error && <p className="text-xs text-red-400 ml-6 mb-1">{error}</p>}
      <div className="flex gap-2 ml-6">
        <button
          type="button"
          onClick={() => handleDecide('allow_once')}
          disabled={deciding}
          className="px-3 py-1 text-xs rounded-md border border-green-800/40 text-green-400 hover:bg-green-900/20 disabled:opacity-50"
        >
          {t('permission.allowOnce')}
        </button>
        <button
          type="button"
          onClick={() => handleDecide('allow_always')}
          disabled={deciding}
          className="px-3 py-1 text-xs rounded-md bg-green-600 text-white hover:bg-green-500 disabled:opacity-50"
        >
          {t('permission.allowAlways')}
        </button>
        <button
          type="button"
          onClick={() => handleDecide('deny')}
          disabled={deciding}
          className="px-3 py-1 text-xs rounded-md border border-red-800/40 text-red-400 hover:bg-red-900/20 disabled:opacity-50"
        >
          {t('permission.deny')}
        </button>
      </div>
    </div>
  );
}
