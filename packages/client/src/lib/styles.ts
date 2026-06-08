// Shared Tailwind class strings for form controls, kept in one place so input
// styling stays consistent across pages. (HTML treats any run of whitespace in
// a class attribute as a separator, so this single-line form is equivalent to
// the previous multi-line template literals.)
//
// `INPUT_CLS` is the compact (text-xs) variant used in the narrow sidebar panels
// (knowledge / memory). The settings pages use the larger `INPUT_FIELD_CLS` /
// `SELECT_FIELD_CLS` (text-sm) variants below.
export const INPUT_CLS =
  'w-full px-3 py-2 bg-dark-input border border-dark-border rounded-lg text-xs text-ink-primary placeholder:text-ink-muted focus:outline-none focus:border-primary-600/40 transition-colors';

export const INPUT_FIELD_CLS =
  'w-full px-3 py-2 bg-dark-input border border-dark-border rounded-lg text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none focus:border-primary-600/40 transition-colors';

export const SELECT_FIELD_CLS =
  'w-full px-3 py-2 bg-dark-input border border-dark-border rounded-lg text-sm text-ink-primary focus:outline-none focus:border-primary-600/40 transition-colors appearance-none';
