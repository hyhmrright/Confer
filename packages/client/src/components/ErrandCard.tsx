import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TranslationKey } from '../i18n/index.js';
import { dateLocale } from '../i18n/index.js';
import { DISABLED, DISABLED_FILLED, FOCUS_RING } from '../lib/styles.js';
import type { ErrandCard as ErrandCardData } from '../stores/errands.js';
import { useErrandsStore } from '../stores/errands.js';
import { DecisionRecord } from './DecisionRecord.js';
import { Shield } from './Icons.js';

// Format integer cents as a currency amount (e.g. 21000 + USD -> "$210.00").
function formatCents(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
  } catch {
    // Unknown currency code: fall back to a plain decimal + code.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

// Countdown to expiry, in the largest unit that still reads as a number a person
// would say. It used to return raw minutes and the caller printed `${minutes}m`,
// so a card with two days on it announced "Expires in 2879m" — the comment above
// it claimed to be a human countdown while doing arithmetic out loud.
//
// `Intl.NumberFormat` with `style: 'unit'` does the plural and the word order per
// locale, so "1 day" / "2 days" / "2天" / "2日" all come out right without a key
// per unit per language.
function expiryLabel(expiresAt: string, locale: string): { text: string; expired: boolean } {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return { text: '', expired: true };

  const minutes = Math.round(ms / 60000);
  const [value, unit] =
    minutes >= 1440
      ? ([Math.round(minutes / 1440), 'day'] as const)
      : minutes >= 60
        ? ([Math.round(minutes / 60), 'hour'] as const)
        : ([minutes, 'minute'] as const);

  return {
    text: new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long' }).format(value),
    expired: false,
  };
}

// i18n key for the post-decision confirmation label, by decision.
const decidedLabelKey: Record<string, TranslationKey> = {
  approve: 'errand.approved',
  change_price: 'errand.priceChanged',
  reject: 'errand.rejected',
};

// One outbound errand decision card: approve / change-price / reject. This is the
// owner reviewing their own delegated agent's action — deliberately NOT the
// PermissionCard (which is inbound connection consent with different semantics).
export function ErrandCard({ card }: { card: ErrandCardData }) {
  const { t } = useTranslation();
  const decideCard = useErrandsStore((s) => s.decideCard);
  const [deciding, setDeciding] = useState(false);
  const [decided, setDecided] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [newPrice, setNewPrice] = useState('');

  const { text: expiresIn, expired } = expiryLabel(card.expires_at, dateLocale());

  const decide = async (decision: 'approve' | 'change_price' | 'reject', cents?: number) => {
    setDeciding(true);
    setError(null);
    try {
      await decideCard(card.id, decision, cents);
      setDecided(decision);
    } catch {
      setDeciding(false);
      setError(t('errand.decideError'));
    }
  };

  const submitChangePrice = () => {
    const value = Number(newPrice);
    // A counter-offer must be a positive amount; reject empty / 0 / negative input.
    if (!Number.isFinite(value) || value <= 0) return;
    decide('change_price', Math.round(value * 100));
  };

  if (decided) {
    return (
      <DecisionRecord
        summary={card.errand_title}
        outcome={t(decidedLabelKey[decided] ?? 'errand.approved')}
        tone={decided === 'reject' ? 'refused' : 'accepted'}
      />
    );
  }

  return (
    <div className="rounded-lg border-2 border-yellow-800/40 bg-yellow-900/20 px-4 py-3 animate-fade-in">
      <div className="flex items-start gap-2 mb-2">
        <Shield className="w-4 h-4 mt-0.5 text-ink-secondary" />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-ink-secondary">{card.errand_title}</span>
            <span className="text-xs ms-auto shrink-0 text-ink-muted">
              {card.strictly_necessary ? t('errand.necessary') : t('errand.optional')}
            </span>
          </div>
          <p className="text-sm text-ink-primary">{card.summary}</p>

          {card.kind === 'change_price' && card.base_price_cents != null && (
            <div className="mt-1 text-xs text-ink-secondary">
              <span>
                {t('errand.basePrice', {
                  price: formatCents(card.base_price_cents, card.currency),
                })}
              </span>
              {card.price_delta_cents != null && (
                <span className="ms-2 text-yellow-400">
                  {t('errand.priceDelta', {
                    delta: `${card.price_delta_cents >= 0 ? '+' : ''}${formatCents(card.price_delta_cents, card.currency)}`,
                  })}
                </span>
              )}
            </div>
          )}

          <p className="mt-1 text-xs text-ink-muted">
            {expired ? t('errand.expired') : t('errand.expiresIn', { time: expiresIn })}
          </p>
        </div>
      </div>

      {error && <p className="text-xs text-red-400 ms-6 mb-1">{error}</p>}

      {changing ? (
        <div className="flex gap-2 ms-6">
          <input
            type="number"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            placeholder={t('errand.newPricePlaceholder', { currency: card.currency })}
            className="flex-1 px-2 py-1 text-xs rounded-md bg-dark-base border border-dark-border text-ink-primary"
          />
          <button
            type="button"
            onClick={submitChangePrice}
            disabled={deciding || newPrice === ''}
            className={`px-3 py-1 text-xs rounded-md bg-primary-600 text-white hover:bg-primary-500 ${DISABLED_FILLED} ${FOCUS_RING}`}
          >
            {t('errand.changePrice')}
          </button>
        </div>
      ) : (
        <div className="flex gap-2 ms-6">
          <button
            type="button"
            onClick={() => decide('approve')}
            disabled={deciding || expired}
            className={`px-3 py-1 text-xs rounded-md border border-primary-600/50 text-primary-300 hover:bg-primary-600/15 ${DISABLED} ${FOCUS_RING}`}
          >
            {t('errand.approve')}
          </button>
          <button
            type="button"
            onClick={() => setChanging(true)}
            disabled={deciding || expired}
            className={`px-3 py-1 text-xs rounded-md border border-dark-active text-ink-primary hover:bg-dark-hover ${DISABLED} ${FOCUS_RING}`}
          >
            {t('errand.changePrice')}
          </button>
          <button
            type="button"
            onClick={() => decide('reject')}
            disabled={deciding || expired}
            className={`px-3 py-1 text-xs rounded-md border border-dark-active text-ink-primary hover:bg-dark-hover ${DISABLED} ${FOCUS_RING}`}
          >
            {t('errand.reject')}
          </button>
        </div>
      )}
    </div>
  );
}
