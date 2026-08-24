import type { ReactNode } from 'react';

// Inline status banner shared across settings tabs. The roles matter: these
// banners appear well away from the control that triggered them, so without a
// live region a screen reader user gets no signal that a save failed. `alert`
// interrupts for errors, `status` waits for a pause for successes.
export function StatusMsg({ error, success }: { error: string | null; success: string | null }) {
  return (
    <>
      {error && (
        <div role="alert" className="px-3 py-2 bg-red-900/20 border border-red-800/40 rounded-lg">
          <p className="text-red-400 text-xs">{error}</p>
        </div>
      )}
      {success && (
        <div
          role="status"
          className="px-3 py-2 bg-green-900/20 border border-green-800/40 rounded-lg"
        >
          <p className="text-green-400 text-xs">{success}</p>
        </div>
      )}
    </>
  );
}

const FIELD_LABEL_CLS = 'block text-xs font-medium text-ink-secondary mb-1.5';

// Pass `htmlFor` whenever the label sits above an actual control, so the two are
// programmatically associated and the control isn't announced as unnamed.
// Without it this renders a span — correct for read-only rows, which have a
// caption but no control to label.
export function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  if (htmlFor === undefined) {
    return <span className={FIELD_LABEL_CLS}>{children}</span>;
  }
  return (
    <label htmlFor={htmlFor} className={FIELD_LABEL_CLS}>
      {children}
    </label>
  );
}
