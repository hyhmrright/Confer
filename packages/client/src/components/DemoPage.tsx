import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { dateLocale } from '../i18n/index.js';
import { DISABLED, FOCUS_RING } from '../lib/styles.js';
import { LanguageSwitcherCompact } from './LanguageSwitcher.js';

const primaryButton = `rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 ${FOCUS_RING}`;
const secondaryButton = `rounded-lg border border-dark-border px-3 py-2 text-sm hover:bg-dark-hover ${FOCUS_RING} ${DISABLED}`;

/** An offline mock peer: reproducible and clearly separated from real accounts. */
export function DemoPage() {
  const { t } = useTranslation();
  const [connected, setConnected] = useState(false);
  const [expires, setExpires] = useState(0);
  const [answer, setAnswer] = useState<'technical' | 'private' | 'purchase' | null>(null);
  const [decision, setDecision] = useState<'approved' | 'denied' | null>(null);
  useEffect(() => {
    if (!expires) return;
    const timer = setTimeout(
      () => {
        setExpires(0);
        setAnswer(null);
      },
      Math.max(0, expires - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expires]);
  const authorized = expires > Date.now();
  return (
    <main className="max-w-2xl mx-auto p-6 space-y-6 text-ink-primary">
      <div className="flex justify-between">
        <Link to="/">{t('features.back')}</Link>
        <LanguageSwitcherCompact />
      </div>
      <h1 className="font-display text-3xl">{t('features.demo')}</h1>
      <p className="text-sm text-ink-secondary">{t('features.demoHint')}</p>
      <section className="rounded-xl border border-dark-border bg-dark-card p-5 space-y-3">
        <h2 className="font-semibold">X100 · {t('features.demoPeer')}</h2>
        <p className="text-sm">{t('features.demoProfile')}</p>
        {connected && (
          <div className="border-t border-dark-border pt-3 space-y-1">
            <p className="text-xs text-peer-400">{t('features.connected')}</p>
            <p className="text-sm text-ink-secondary">{t('features.demoScope')}</p>
          </div>
        )}
        {!connected ? (
          <button className={primaryButton} type="button" onClick={() => setConnected(true)}>
            {t('features.addContact')}
          </button>
        ) : authorized ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-peer-400" role="status">
              {t('apiTokens.expires', { when: new Date(expires).toLocaleTimeString(dateLocale()) })}
            </p>
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                setExpires(0);
                setAnswer(null);
              }}
            >
              {t('features.revoke')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={primaryButton}
            onClick={() => {
              setAnswer(null);
              setExpires(Date.now() + 120_000);
            }}
          >
            {t('features.authorizeManual')}
          </button>
        )}
      </section>
      <section className="space-y-3">
        <h2>{t('features.demoAsk')}</h2>
        <div className="flex flex-wrap gap-3">
          {(['technical', 'private', 'purchase'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              disabled={!authorized}
              className={secondaryButton}
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
                <a
                  className="underline text-peer-400"
                  href="/examples/x100-manual.md"
                  target="_blank"
                  rel="noreferrer"
                >
                  X100 demo manual § Power and communication ↗
                </a>
              </blockquote>
            )}
            {answer === 'purchase' && (
              <>
                <div className="flex gap-4">
                  <button
                    type="button"
                    className={secondaryButton}
                    disabled={!!decision}
                    onClick={() => setDecision('approved')}
                  >
                    {t('features.authorize')}
                  </button>
                  <button
                    type="button"
                    className={secondaryButton}
                    disabled={!!decision}
                    onClick={() => setDecision('denied')}
                  >
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
      <footer className="flex flex-wrap gap-5 border-t border-dark-border pt-4 text-sm text-ink-secondary">
        <button
          className={`underline ${FOCUS_RING} ${DISABLED}`}
          disabled={!connected}
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
        <Link className={`underline ${FOCUS_RING}`} to="/login">
          {t('login.login')}
        </Link>
      </footer>
    </main>
  );
}
