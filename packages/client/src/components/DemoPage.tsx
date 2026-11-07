import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { LanguageSwitcherCompact } from './LanguageSwitcher.js';

/** An offline mock peer: reproducible and clearly separated from real accounts. */
export function DemoPage() {
  const { t } = useTranslation();
  const [connected, setConnected] = useState(false);
  const [expires, setExpires] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [answer, setAnswer] = useState<'technical' | 'private' | 'purchase' | null>(null);
  const [decision, setDecision] = useState<'approved' | 'denied' | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const authorized = connected && expires > now;
  return (
    <main className="max-w-2xl mx-auto p-6 space-y-6 text-ink-primary">
      <div className="flex justify-between">
        <Link to="/">{t('features.back')}</Link>
        <LanguageSwitcherCompact />
      </div>
      <h1 className="text-2xl">{t('features.demo')}</h1>
      <p className="text-sm text-ink-secondary">{t('features.demoHint')}</p>
      <section className="rounded-xl border border-dark-border bg-dark-card p-5 space-y-3">
        <h2 className="font-semibold">X100 · {t('features.demoPeer')}</h2>
        <p className="text-sm">{t('features.demoProfile')}</p>
        <button type="button" disabled={connected} onClick={() => setConnected(true)}>
          {connected ? t('features.connected') : t('features.addContact')}
        </button>
      </section>
      {connected && (
        <section className="space-y-3">
          <h2>{t('features.grants')}</h2>
          <p className="text-sm">{t('features.demoScope')}</p>
          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => {
                setNow(Date.now());
                setExpires(Date.now() + 120_000);
                setAnswer(null);
              }}
            >
              {t('features.authorize')}
            </button>
            <button
              type="button"
              disabled={!authorized}
              onClick={() => {
                setExpires(0);
                setAnswer(null);
              }}
            >
              {t('features.revoke')}
            </button>
          </div>
          <p className="text-xs" role="status">
            {authorized
              ? `${t('features.hours')}: ${new Date(expires).toLocaleTimeString()}`
              : t('features.demoNeedsGrant')}
          </p>
        </section>
      )}
      <section className="space-y-3">
        <h2>{t('features.demoAsk')}</h2>
        <div className="flex flex-wrap gap-3">
          {(['technical', 'private', 'purchase'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              disabled={!authorized}
              className="rounded-lg border border-dark-border p-3 text-sm disabled:opacity-40"
              onClick={() => {
                setAnswer(kind);
                setDecision(null);
              }}
            >
              {t(
                kind === 'technical'
                  ? 'features.demoTechnical'
                  : kind === 'private'
                    ? 'features.demoPrivate'
                    : 'features.demoPurchase',
              )}
            </button>
          ))}
        </div>
        {answer && authorized && (
          <article
            className="border border-dark-border rounded-xl p-5 space-y-3"
            aria-live="polite"
          >
            <p>
              {t(
                answer === 'technical'
                  ? 'features.demoAnswer'
                  : answer === 'private'
                    ? 'features.demoRefusal'
                    : 'features.demoApproval',
              )}
            </p>
            {answer === 'technical' && (
              <blockquote className="text-xs text-ink-secondary border-s-2 ps-3">
                24 V DC · Modbus RTU / RS-485 · 9600 8N1 · address 1<br />
                <a href="/examples/x100-manual.md" target="_blank" rel="noreferrer">
                  X100 demo manual § Power and communication ↗
                </a>
              </blockquote>
            )}
            {answer === 'purchase' && (
              <>
                <div className="flex gap-4">
                  <button
                    type="button"
                    disabled={!!decision}
                    onClick={() => setDecision('approved')}
                  >
                    {t('features.authorize')}
                  </button>
                  <button type="button" disabled={!!decision} onClick={() => setDecision('denied')}>
                    {t('features.deny')}
                  </button>
                </div>
                {decision && (
                  <p role="status">
                    {t(decision === 'approved' ? 'features.demoApproved' : 'features.demoDenied')}
                  </p>
                )}
              </>
            )}
          </article>
        )}
      </section>
      <button
        type="button"
        onClick={() => {
          setConnected(false);
          setExpires(0);
          setAnswer(null);
          setDecision(null);
        }}
      >
        {t('features.resetDemo')}
      </button>
      <Link className="block text-primary-400" to="/login">
        {t('login.login')}
      </Link>
    </main>
  );
}
