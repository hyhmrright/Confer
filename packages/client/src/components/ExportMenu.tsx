import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.js';
import {
  type ConversationExport,
  downloadText,
  exportFileName,
  exportToMarkdown,
} from '../lib/conversation-export.js';
import { FOCUS_RING } from '../lib/styles.js';

const ITEM = `w-full text-start px-3 py-1.5 text-xs text-ink-secondary hover:bg-dark-hover hover:text-ink-primary ${FOCUS_RING}`;

// Save the open thread as a file: Markdown to read, JSON to process.
export function ExportMenu({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const save = async (format: 'md' | 'json') => {
    setOpen(false);
    setError(false);
    try {
      const data = await api.get<ConversationExport>(`/conversations/${conversationId}/export`);
      if (format === 'md') {
        downloadText(exportFileName(data, 'md'), exportToMarkdown(data), 'text/markdown');
      } else {
        downloadText(
          exportFileName(data, 'json'),
          JSON.stringify(data, null, 2),
          'application/json',
        );
      }
    } catch {
      setError(true);
    }
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`px-2 py-1 rounded-md eyebrow text-ink-muted hover:text-ink-secondary hover:bg-dark-hover ${FOCUS_RING}`}
      >
        {t('export.button')}
      </button>
      {error && (
        <span
          role="alert"
          className="absolute end-0 top-full mt-1 whitespace-nowrap text-xs text-red-400"
        >
          {t('export.failed')}
        </span>
      )}
      {open && (
        <div
          role="menu"
          className="absolute end-0 top-full mt-1 z-20 min-w-32 py-1 rounded-lg border border-dark-border bg-dark-card shadow-lg"
        >
          <button type="button" role="menuitem" onClick={() => save('md')} className={ITEM}>
            {t('export.markdown')}
          </button>
          <button type="button" role="menuitem" onClick={() => save('json')} className={ITEM}>
            {t('export.json')}
          </button>
        </div>
      )}
    </div>
  );
}
