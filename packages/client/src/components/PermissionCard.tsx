import type { PermissionRequestEvent } from '@confer/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TranslationKey } from '../i18n/index.js';
import { api } from '../lib/api.js';
import { describePermission } from '../lib/permission-text.js';
import { DISABLED, FOCUS_RING } from '../lib/styles.js';
import { DecisionRecord } from './DecisionRecord.js';
import { Shield } from './Icons.js';

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
  request: PermissionRequestEvent;
  onDecided?: () => void;
}) {
  const { t } = useTranslation();
  const description = describePermission(request, t);
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
    const allowed = decided.includes('allow');
    return (
      <DecisionRecord
        summary={description}
        outcome={allowed ? t('permission.allowed') : t('permission.denied')}
        tone={allowed ? 'accepted' : 'refused'}
      />
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
          <p className="text-sm text-ink-primary">{description}</p>
        </div>
      </div>
      {error && <p className="text-xs text-red-400 ms-6 mb-1">{error}</p>}
      {/*
        Deny and Allow once carry equal weight; Always allow is quieter than
        both. It used to be the only filled button on the card — the broadest,
        most permanent grant rendered as the visual default on the app's consent
        gate, which is the wrong way round however you weigh it. (Its white text
        on `green-600` also measured 3.22:1, under the 4.5:1 floor, so the loud
        version was not even legible.) Nothing here is filled now: three
        decisions of genuinely different consequence should be read, not
        aimed at.
      */}
      <div className="flex flex-wrap gap-2 ms-6">
        <button
          type="button"
          onClick={() => handleDecide('deny')}
          disabled={deciding}
          className={`px-3 py-1 text-xs rounded-md border border-dark-active text-ink-primary hover:bg-dark-hover ${DISABLED} ${FOCUS_RING}`}
        >
          {t('permission.deny')}
        </button>
        <button
          type="button"
          onClick={() => handleDecide('allow_once')}
          disabled={deciding}
          className={`px-3 py-1 text-xs rounded-md border border-primary-600/50 text-primary-300 hover:bg-primary-600/15 ${DISABLED} ${FOCUS_RING}`}
        >
          {t('permission.allowOnce')}
        </button>
        <button
          type="button"
          onClick={() => handleDecide('allow_always')}
          disabled={deciding}
          className={`px-3 py-1 text-xs rounded-md text-ink-secondary hover:text-ink-primary hover:bg-dark-hover ${DISABLED} ${FOCUS_RING}`}
        >
          {t('permission.allowAlways')}
        </button>
      </div>
    </div>
  );
}
