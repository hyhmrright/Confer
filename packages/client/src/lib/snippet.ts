// The part of `content` around the first case-insensitive match of `query`,
// on one line, with an ellipsis where text was cut. A search hit deep inside a
// long answer is useless if the row shows only the answer's first sentence.
export function snippetAround(content: string, query: string, radius = 40): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  const at = flat.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return flat.length > radius * 2 ? `${flat.slice(0, radius * 2)}…` : flat;

  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + query.length + radius);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}
