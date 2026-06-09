import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TranslationKey } from '../i18n/index.js';
import type { ErrandCard as ErrandCardData } from '../stores/errands.js';
import { useErrandsStore } from '../stores/errands.js';
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

// Human countdown to expiry: whole minutes remaining (floored at 0) plus an
// expired flag once the deadline has passed.
function expiryLabel(expiresAt: string): { minutes: number; expired: boolean } {
  const ms = new Date(expiresAt).getTime() - Date.now();
  return { minutes: Math.max(0, Math.round(ms / 60000)), expired: ms <= 0 };
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

  const { minutes, expired } = expiryLabel(card.expires_at);

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
    if (!Number.isFinite(value)) return;
    decide('change_price', Math.round(value * 100));
  };

  if (decided) {
    const label = t(decidedLabelKey[decided] ?? 'errand.approved');
    const color = decided === 'reject' ? 'text-red-400' : 'text-green-400';
    return (
      <div className="rounded-lg border-2 border-dark-border bg-dark-card px-4 py-3 opacity-60">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-ink-muted" />
          <span className="text-sm text-ink-secondary">{card.errand_title}</span>
          <span className={`text-sm font-medium ml-auto ${color}`}>{label}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border-2 border-yellow-800/40 bg-yellow-900/20 px-4 py-3 animate-fade-in">
      <div className="flex items-start gap-2 mb-2">
        <Shield className="w-4 h-4 mt-0.5 text-ink-secondary" />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-ink-secondary">{card.errand_title}</span>
            <span
              className={`text-xs ml-auto ${card.strictly_necessary ? 'text-ink-muted' : 'text-ink-muted/60'}`}
            >
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
                <span className="ml-2 text-yellow-400">
                  {t('errand.priceDelta', {
                    delta: `${card.price_delta_cents >= 0 ? '+' : ''}${formatCents(card.price_delta_cents, card.currency)}`,
                  })}
                </span>
              )}
            </div>
          )}

          <p className="mt-1 text-xs text-ink-muted">
            {expired ? t('errand.expired') : t('errand.expiresIn', { time: `${minutes}m` })}
          </p>
        </div>
      </div>

      {error && <p className="text-xs text-red-400 ml-6 mb-1">{error}</p>}

      {changing ? (
        <div className="flex gap-2 ml-6">
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
            className="px-3 py-1 text-xs rounded-md bg-yellow-600 text-white hover:bg-yellow-500 disabled:opacity-50"
          >
            {t('errand.changePrice')}
          </button>
        </div>
      ) : (
        <div className="flex gap-2 ml-6">
          <button
            type="button"
            onClick={() => decide('approve')}
            disabled={deciding || expired}
            className="px-3 py-1 text-xs rounded-md bg-green-600 text-white hover:bg-green-500 disabled:opacity-50"
          >
            {t('errand.approve')}
          </button>
          <button
            type="button"
            onClick={() => setChanging(true)}
            disabled={deciding || expired}
            className="px-3 py-1 text-xs rounded-md border border-yellow-800/40 text-yellow-400 hover:bg-yellow-900/20 disabled:opacity-50"
          >
            {t('errand.changePrice')}
          </button>
          <button
            type="button"
            onClick={() => decide('reject')}
            disabled={deciding || expired}
            className="px-3 py-1 text-xs rounded-md border border-red-800/40 text-red-400 hover:bg-red-900/20 disabled:opacity-50"
          >
            {t('errand.reject')}
          </button>
        </div>
      )}
    </div>
  );
}
