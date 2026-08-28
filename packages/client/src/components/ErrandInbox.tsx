import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useErrandsStore } from '../stores/errands.js';
import { ErrandCard } from './ErrandCard.js';
import { Plus } from './Icons.js';

// Owner-facing outbound errand inbox: a stack of pending decision cards plus a
// one-line "delegate an errand" form (owner self-create path). Cards arrive via
// polling (loadPendingCards), not WebSocket. Independent of the inbound
// PermissionInbox.
export function ErrandInbox() {
  const { t } = useTranslation();
  const pendingCards = useErrandsStore((s) => s.pendingCards);
  const creating = useErrandsStore((s) => s.creating);
  const error = useErrandsStore((s) => s.error);
  const createErrand = useErrandsStore((s) => s.createErrand);
  const [title, setTitle] = useState('');
  const [open, setOpen] = useState(false);

  const submit = async () => {
    const value = title.trim();
    if (!value) return;
    await createErrand(value);
    setTitle('');
    setOpen(false);
  };

  // `bottom-24`, not `bottom-4`: the composer owns the bottom of the message
  // area, and at `bottom-4` this stack sat directly on top of the send button.
  const ANCHOR = 'fixed bottom-24 right-4 z-40';

  if (pendingCards.length === 0 && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${ANCHOR} flex items-center gap-1.5 px-3 py-2 rounded-full bg-dark-card/90 backdrop-blur-sm border border-dark-border text-xs text-ink-secondary hover:text-ink-primary hover:border-dark-active shadow-lg shadow-black/30 transition-colors`}
      >
        <Plus className="w-3.5 h-3.5" />
        {t('errand.createTitle')}
      </button>
    );
  }

  return (
    <div className={`${ANCHOR} w-80 max-w-[calc(100vw-2rem)] space-y-2`}>
      {pendingCards.map((card) => (
        <ErrandCard key={card.id} card={card} />
      ))}

      {open ? (
        <div className="rounded-lg border border-dark-border bg-dark-card px-4 py-3 space-y-2 shadow-lg shadow-black/30">
          <p className="text-xs font-medium text-ink-secondary">{t('errand.createTitle')}</p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder={t('errand.titlePlaceholder')}
            className="w-full px-2 py-1 text-sm rounded-md bg-dark-base border border-dark-border text-ink-primary"
          />
          {error && <p className="text-xs text-red-400">{t('errand.createError')}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={creating || title.trim() === ''}
              className="px-3 py-1 text-xs rounded-md bg-primary-600 text-white hover:bg-primary-500 disabled:opacity-50"
            >
              {creating ? t('errand.creating') : t('errand.create')}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-3 py-1 text-xs rounded-md border border-dark-border text-ink-secondary hover:text-ink-primary"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-dark-card border border-dark-border text-xs text-ink-secondary hover:text-ink-primary"
        >
          <Plus className="w-4 h-4" />
          {t('errand.createTitle')}
        </button>
      )}
    </div>
  );
}
