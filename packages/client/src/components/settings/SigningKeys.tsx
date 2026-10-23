import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api.js';
import { formatShortDateTime } from '../../lib/format-date.js';
import { FOCUS_RING } from '../../lib/styles.js';
import { StatusMsg } from './SettingsShared.js';

interface SigningKey {
  key_id: string;
  created_at: string;
  status: 'current' | 'retiring' | 'revoked';
  retires_at: string | null;
}

const STATUS_TONE: Record<SigningKey['status'], string> = {
  current: 'text-green-400',
  retiring: 'text-yellow-400',
  revoked: 'text-ink-muted',
};

// The keys the agent signs with. Rotation is two clicks rather than a modal:
// it is safe to do (the old key keeps verifying), just not something to do by
// accident.
export function SigningKeys() {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<SigningKey[]>([]);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = () =>
    api
      .get<{ keys: SigningKey[] }>('/users/me/keys')
      .then((data) => setKeys(data.keys))
      .catch(() => setError(t('security.failed')));

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    void load();
  }, []);

  const act = async (run: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await run();
      if (done) setSuccess(done);
      await load();
    } catch {
      setError(t('security.failed'));
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };

  const rotate = () => {
    if (!armed) return setArmed(true);
    void act(() => api.post('/users/me/keys/rotate', {}), t('signingKeys.rotated'));
  };

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold text-ink-primary">{t('signingKeys.heading')}</h3>
      <p className="text-xs text-ink-secondary">{t('signingKeys.hint')}</p>
      <ul className="space-y-2">
        {keys.map((key) => (
          <li
            key={key.key_id}
            className="flex items-center gap-3 px-3 py-2 bg-dark-input border border-dark-border rounded-lg"
          >
            <div className="flex-1 min-w-0">
              <p className="text-xs font-mono text-ink-primary truncate">
                #{key.key_id.split('#').pop()}
              </p>
              <p className="text-[11px] text-ink-muted">
                <span className={STATUS_TONE[key.status]}>{t(`signingKeys.${key.status}`)}</span>
                {' · '}
                {key.status === 'retiring' && key.retires_at
                  ? t('signingKeys.retires', { when: formatShortDateTime(key.retires_at) })
                  : t('signingKeys.created', { when: formatShortDateTime(key.created_at) })}
              </p>
            </div>
            {key.status === 'retiring' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => act(() => api.post('/users/me/keys/revoke', { key_id: key.key_id }))}
                className={`shrink-0 px-2 py-1 rounded text-xs text-ink-muted hover:text-red-400 hover:bg-dark-hover ${FOCUS_RING}`}
              >
                {t('signingKeys.revoke')}
              </button>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={busy}
        onClick={rotate}
        className={`px-3 py-1.5 rounded-lg border text-xs ${armed ? 'border-yellow-600 text-yellow-300' : 'border-dark-border text-ink-secondary hover:bg-dark-hover'} ${FOCUS_RING}`}
      >
        {armed ? t('signingKeys.rotateConfirm') : t('signingKeys.rotate')}
      </button>
      <StatusMsg error={error} success={success} />
    </section>
  );
}
