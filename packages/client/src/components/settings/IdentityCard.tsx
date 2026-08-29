import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FOCUS_RING } from '../../lib/styles.js';
import { Check, Copy } from '../Icons.js';

/*
  The agent's DID, promoted out of the form.

  It used to be a disabled text input at 60% opacity, sitting directly under the
  username field and styled identically — so the address other people's agents
  use to reach yours read as the same kind of dead furniture as a login handle
  you happen not to be allowed to edit. It is the one object in this product
  that is worth showing off, and the only one anybody ever needs to hand to
  someone else, which is why it now has a copy button instead of a
  select-all-and-hope.
*/
export function IdentityCard({ did }: { did: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(did);
      setCopied(true);
    } catch {
      // Clipboard is permission-gated and can simply refuse. The DID is on
      // screen and selectable either way, so a failure needs no error state.
    }
  };

  return (
    <section className="rounded-lg border border-dark-border bg-dark-panel p-4 border-l-2 border-l-peer-600">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="eyebrow text-peer-400">{t('settings.identityLabel')}</h3>
          <p className="mt-2 font-mono text-[13px] text-ink-primary break-all select-all">{did}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
            {t('settings.identityHint')}
          </p>
        </div>
        <button
          type="button"
          onClick={copy}
          aria-label={t(copied ? 'common.copied' : 'common.copy')}
          className={`shrink-0 flex items-center gap-1.5 rounded-md border border-dark-border px-2.5 py-1.5 text-[11px] transition-colors ${FOCUS_RING} ${
            copied
              ? 'border-peer-600 text-peer-400'
              : 'text-ink-secondary hover:border-dark-active hover:text-ink-primary'
          }`}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {t(copied ? 'common.copied' : 'common.copy')}
        </button>
      </div>
    </section>
  );
}
