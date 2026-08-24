import { useEffect, useState } from 'react';

// Tailwind's `md` breakpoint seen from below: true under 768px, where the nav
// rail and the sidebar collapse into a single drawer.
//
// The layout itself is plain CSS (`md:` variants). This hook exists for the two
// things CSS can't express: closing the drawer when the viewport grows past the
// breakpoint — otherwise it would still be "open" as an overlay that no longer
// exists — and marking the main content inert only while the drawer covers it.
const NARROW = '(max-width: 767.98px)';

export function useIsNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);

  useEffect(() => {
    const query = window.matchMedia(NARROW);
    const sync = () => setNarrow(query.matches);
    // Re-read once on mount: the viewport can change between the first render
    // and this effect, and server-less first paint has no listener yet.
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return narrow;
}
