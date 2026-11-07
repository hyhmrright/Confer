import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.js';
import { INPUT_FIELD_CLS } from '../lib/styles.js';

export function PeerCredential({ peerId }: { peerId: string }) {
  const { t } = useTranslation();
  const [configured, setConfigured] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    void api
      .get<{ configured: boolean }>(`/capabilities/remote/${peerId}`)
      .then((d) => {
        if (live) setConfigured(d.configured);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [peerId]);
  const run = async (remove: boolean) => {
    setBusy(true);
    setError(false);
    try {
      if (remove) await api.delete(`/capabilities/remote/${peerId}`);
      else await api.put(`/capabilities/remote/${peerId}`, { token: value });
      setConfigured(!remove);
      setValue('');
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-2 text-xs">
      <h3>{t('features.grants')}</h3>
      <p>{t('features.remoteGrant')}</p>
      <input
        aria-label={t('features.remoteGrant')}
        type="password"
        autoComplete="off"
        className={INPUT_FIELD_CLS}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="flex gap-3">
        <button
          type="button"
          disabled={busy || !/^cfc_[A-Za-z0-9_-]{43}$/.test(value)}
          onClick={() => run(false)}
        >
          {t('common.save')}
        </button>
        <button type="button" disabled={busy || !configured} onClick={() => run(true)}>
          {t('features.revoke')}
        </button>
      </div>
      {configured && <p>{t('features.configured')}</p>}
      {error && <p role="alert">{t('features.failed')}</p>}
    </section>
  );
}
