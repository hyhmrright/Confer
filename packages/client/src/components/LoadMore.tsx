import { useTranslation } from 'react-i18next';
import { FOCUS_RING } from '../lib/styles.js';

// The footer control for the two lists the gateway now pages rather than
// returning whole: contacts and knowledge-base documents. It renders nothing
// once everything is on screen, so a short list looks exactly as it did before
// paging existed. Showing `shown / total` matters here — without it a capped
// list is indistinguishable from a complete one.
export function LoadMore({
  shown,
  total,
  busy,
  onMore,
}: {
  shown: number;
  total: number;
  busy: boolean;
  onMore: () => void;
}) {
  const { t } = useTranslation();
  if (shown >= total) return null;

  return (
    <button
      type="button"
      onClick={onMore}
      disabled={busy}
      className={`w-full py-3 text-xs text-ink-secondary hover:text-ink-primary hover:bg-dark-hover disabled:opacity-40 transition-colors ${FOCUS_RING}`}
    >
      {busy ? t('common.loading') : t('common.loadMore', { shown, total })}
    </button>
  );
}
