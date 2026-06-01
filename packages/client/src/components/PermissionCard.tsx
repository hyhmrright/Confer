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
  L1: 'border-green-300 bg-green-50',
  L2: 'border-yellow-300 bg-yellow-50',
  L3: 'border-red-300 bg-red-50',
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

  const borderClass = levelColor[request.level] ?? 'border-gray-300 bg-gray-50';

  if (decided) {
    const label = decided.includes('allow') ? t('permission.allowed') : t('permission.denied');
    const color = decided.includes('allow') ? 'text-green-600' : 'text-red-600';
    return (
      <div className={`rounded-lg border-2 px-4 py-3 ${borderClass} opacity-60`}>
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-500">{request.description}</span>
          <span className={`text-sm font-medium ml-auto ${color}`}>{label}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border-2 px-4 py-3 animate-fade-in ${borderClass}`}>
      <div className="flex items-start gap-2 mb-2">
        <Shield className="w-4 h-4 mt-0.5 text-gray-500" />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-gray-500">{request.level}</span>
            <span className="text-xs text-gray-400">
              {levelLabelKey[request.level] ? t(levelLabelKey[request.level]) : request.level}
            </span>
          </div>
          <p className="text-sm text-gray-700">{request.description}</p>
        </div>
      </div>
      {error && <p className="text-xs text-red-500 ml-6 mb-1">{error}</p>}
      <div className="flex gap-2 ml-6">
        <button
          type="button"
          onClick={() => handleDecide('allow_once')}
          disabled={deciding}
          className="px-3 py-1 text-xs rounded-md border border-green-300 text-green-700 hover:bg-green-100 disabled:opacity-50"
        >
          {t('permission.allowOnce')}
        </button>
        <button
          type="button"
          onClick={() => handleDecide('allow_always')}
          disabled={deciding}
          className="px-3 py-1 text-xs rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
        >
          {t('permission.allowAlways')}
        </button>
        <button
          type="button"
          onClick={() => handleDecide('deny')}
          disabled={deciding}
          className="px-3 py-1 text-xs rounded-md border border-red-300 text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          {t('permission.deny')}
        </button>
      </div>
    </div>
  );
}
