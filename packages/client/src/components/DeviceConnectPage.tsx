import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { api } from '../lib/api.js';
import { INPUT_FIELD_CLS } from '../lib/styles.js';
import { useAuthStore } from '../stores/auth.js';

export function DeviceConnectPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [request, setRequest] = useState<{ name: string; expires_at: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [done, setDone] = useState(false);
  const token = useAuthStore((s) => s.accessToken);
  const username = useAuthStore((s) => s.user?.username);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(false);
    try {
      await action();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="max-w-lg mx-auto p-8 space-y-5 text-ink-primary">
      <h1 className="text-xl">{t('features.connect')}</h1>
      {!token ? (
        <>
          <p>{t('features.signInFirst')}</p>
          <Link to={`/login?connect=${encodeURIComponent(code)}`}>{t('login.login')}</Link>
        </>
      ) : done ? (
        <p role="status">{t('features.connectDone')}</p>
      ) : (
        <>
          <p className="text-sm">{t('features.connectHint', { username })}</p>
          <label className="block text-sm">
            {t('features.deviceCode')}
            <input
              className={INPUT_FIELD_CLS}
              maxLength={8}
              value={code}
              disabled={!!request}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </label>
          {!request ? (
            <button
              type="button"
              disabled={busy || !/^[A-F0-9]{8}$/.test(code)}
              onClick={() =>
                run(async () =>
                  setRequest(await api.post('/device-auth/request', { user_code: code })),
                )
              }
            >
              {t('features.review')}
            </button>
          ) : (
            <section className="space-y-4 border border-dark-border rounded-xl p-4">
              <p className="font-semibold">{request.name}</p>
              <code>{code}</code>
              <p className="text-xs">{t('features.deviceAccess')}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.post('/device-auth/decide', { user_code: code, approve: true });
                    setDone(true);
                  })
                }
              >
                {t('features.authorize')}
              </button>
              {' · '}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.post('/device-auth/decide', { user_code: code, approve: false });
                    setDone(true);
                  })
                }
              >
                {t('features.deny')}
              </button>
            </section>
          )}
        </>
      )}
      {error && <p role="alert">{t('features.failed')}</p>}
      <Link to="/">{t('features.back')}</Link>
    </main>
  );
}
