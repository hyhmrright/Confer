import type { ReactNode } from 'react';

// Inline status banner shared across settings tabs.
export function StatusMsg({ error, success }: { error: string | null; success: string | null }) {
  return (
    <>
      {error && (
        <div className="px-3 py-2 bg-red-900/20 border border-red-800/40 rounded-lg">
          <p className="text-red-400 text-xs">{error}</p>
        </div>
      )}
      {success && (
        <div className="px-3 py-2 bg-green-900/20 border border-green-800/40 rounded-lg">
          <p className="text-green-400 text-xs">{success}</p>
        </div>
      )}
    </>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  // Visual field label rendered above (but not htmlFor-bound to) its control;
  // a span avoids a label-without-control a11y error while keeping the styling.
  return <span className="block text-xs font-medium text-ink-secondary mb-1.5">{children}</span>;
}
