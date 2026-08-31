import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';

/**
 * Close an open popover when the pointer goes down outside it, or on Escape.
 *
 * Extracted when the language switcher became the second popover in the app —
 * one inline copy is a detail, two is a pattern that will drift.
 *
 * `close` is held in a ref so callers can pass a plain arrow. Depending on it
 * directly would mean every caller had to wrap it in `useCallback`, and one
 * that forgot would silently rebind both document listeners on every render —
 * a leak with no symptom until something else made renders frequent. Both
 * listeners are bound only while `open`, so a closed popover costs nothing.
 */
export function useDismissable(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
): void {
  const closeRef = useRef(close);
  // Assigned after commit rather than during render — React treats a ref
  // written mid-render as a side effect, and a discarded concurrent render
  // would still have moved it.
  useEffect(() => {
    closeRef.current = close;
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, ref]);
}
