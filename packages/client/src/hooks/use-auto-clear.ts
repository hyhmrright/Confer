import { useEffect, useRef } from 'react';

/**
 * Clear a success/error status message three seconds after it appears.
 *
 * `clear` is held in a ref so callers can pass a plain arrow without the timer
 * restarting on every render.
 */
export function useAutoClear(success: unknown, error: unknown, clear: () => void): void {
  const clearRef = useRef(clear);
  useEffect(() => {
    clearRef.current = clear;
  });

  useEffect(() => {
    if (success || error) {
      const timer = setTimeout(() => clearRef.current(), 3000);
      return () => clearTimeout(timer);
    }
  }, [success, error]);
}
