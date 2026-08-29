// Shared Tailwind class strings for form controls, kept in one place so input
// styling stays consistent across pages. (HTML treats any run of whitespace in
// a class attribute as a separator, so this single-line form is equivalent to
// the previous multi-line template literals.)
//
// `INPUT_CLS` is the compact (text-xs) variant used in the narrow sidebar panels
// (knowledge / memory). The settings pages use the larger `INPUT_FIELD_CLS` /
// `SELECT_FIELD_CLS` (text-sm) variants below.
// The keyboard focus indicator, shared by every control that suppresses the
// browser's own outline. `focus:outline-hidden` on its own left the border
// colour as the only thing that changed on focus, which measures 1.54:1 against
// the field it surrounds — WCAG 2.4.11 asks for 3:1, so keyboard users had
// nothing to see. The ring is primary-500 over dark-input at 6.2:1.
// `focus-visible` keeps it off mouse clicks while still drawing it for Tab.
export const FOCUS_RING =
  'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-transparent';

export const INPUT_CLS = `w-full px-3 py-2 bg-dark-input border border-dark-border rounded-lg text-xs text-ink-primary placeholder:text-ink-muted ${FOCUS_RING} transition-colors`;

export const INPUT_FIELD_CLS = `w-full px-3 py-2 bg-dark-input border border-dark-border rounded-lg text-sm text-ink-primary placeholder:text-ink-muted ${FOCUS_RING} transition-colors`;

export const SELECT_FIELD_CLS = `w-full px-3 py-2 bg-dark-input border border-dark-border rounded-lg text-sm text-ink-primary ${FOCUS_RING} transition-colors appearance-none`;

// Disabled state.
//
// The codebase expressed it as `disabled:opacity-{25,30,40,50}` in 24 places —
// four different values, none of them chosen. Measured, `opacity-40` puts
// ink-secondary at 2.24:1 against the page and `opacity-25` puts the composer's
// send arrow at 1.57:1: the control does not read as unavailable, it reads as
// absent, and on the admin tables the pagination simply vanished. Disabled
// controls are exempt from the 4.5:1 text rule, but "exempt from a rule" is not
// a reason to make a control invisible.
//
// Two treatments, because opacity cannot serve both: an outline or ghost control
// fades to a level that still clears 3:1, and a filled one drops its fill
// instead — a solid button dimmed to 55% still reads as a button you may press.
export const DISABLED = 'disabled:opacity-55 disabled:cursor-not-allowed';

export const DISABLED_FILLED =
  'disabled:bg-dark-active disabled:text-ink-muted disabled:shadow-none disabled:cursor-not-allowed';
