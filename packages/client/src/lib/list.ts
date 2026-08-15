// Joining a freshly-fetched page onto a list already on screen.
//
// Every paged list in the client needs this, because no paging scheme here is
// immune to serving a row twice: offset paging (contacts, knowledge-base
// documents) shifts when a row is deleted underneath it, and keyset paging
// (messages) can overlap at the boundary. Two React children with the same key
// is a bug on top of the duplicate row, so drop the repeats at the seam.

interface HasId {
  id: string;
}

/** The next page, joined after what is already shown. */
export function appendNew<T extends HasId>(shown: T[], page: T[]): T[] {
  const seen = new Set(shown.map((item) => item.id));
  return [...shown, ...page.filter((item) => !seen.has(item.id))];
}

/** An older page, joined before what is already shown. */
export function prependNew<T extends HasId>(shown: T[], page: T[]): T[] {
  const seen = new Set(shown.map((item) => item.id));
  return [...page.filter((item) => !seen.has(item.id)), ...shown];
}
