import { dateLocale } from '../i18n/index.js';

/** "Sep 25, 14:05" in the UI language — the compact stamp lists and titles use. */
export function formatShortDateTime(date: Date | string): string {
  return new Date(date).toLocaleString(dateLocale(), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
