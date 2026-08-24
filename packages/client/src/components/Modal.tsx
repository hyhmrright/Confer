import { type ReactNode, useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FOCUS_RING } from '../lib/styles.js';
import { X } from './Icons.js';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Everything a keyboard or screen-reader user needs from a modal, in one place.
// Both dialogs previously repeated the same backdrop and header markup while
// providing none of this: no dialog role, focus never entered the panel, Escape
// did nothing, and the page behind stayed in the tab order.
export function Modal({
  title,
  onClose,
  children,
  panelClassName = '',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  panelClassName?: string;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  // Held in a ref so callers can pass an inline arrow without re-running the
  // effect on every render — which would yank focus back to the first control
  // while the user was typing in the third.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const restoreTo = document.activeElement as HTMLElement | null;
    // The panel itself, not its first control. The first focusable element is
    // the close button, and landing there means an immediate Enter dismisses the
    // dialog the user just opened. Focusing the panel also gets the dialog's
    // name and role announced before its contents.
    panel.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      // Cycle within the panel so Tab can't wander into the page behind it.
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // Coming off the panel itself, either direction has to enter the list
      // rather than fall through to whatever sits behind the backdrop.
      const atStart = active === first || active === panel;
      const atEnd = active === last || active === panel;
      if (e.shiftKey && atStart) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && atEnd) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // Send focus back where it came from, unless that element is gone.
      if (restoreTo?.isConnected) restoreTo.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // -1 keeps the panel out of the tab order while still letting the effect
        // above move focus onto it when the dialog opens.
        tabIndex={-1}
        className={`bg-dark-panel border border-dark-border rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-fade-in focus:outline-hidden ${panelClassName}`}
      >
        <div className="flex justify-between items-center px-6 py-4 border-b border-dark-border shrink-0">
          <h2 id={titleId} className="text-base font-semibold text-ink-primary">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className={`p-1.5 text-ink-muted hover:text-ink-secondary hover:bg-dark-hover rounded-lg transition-colors ${FOCUS_RING}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
