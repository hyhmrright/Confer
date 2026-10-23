// A user's search text as a LIKE/ILIKE "contains" pattern.
//
// `%` and `_` are wildcards in LIKE, so unescaped they let a search for "100%"
// match "1000 apples" and a bare "_" match every row. Postgres's default LIKE
// escape character is the backslash, which therefore has to be escaped first.
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
