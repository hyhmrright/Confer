// Query-string pagination, parsed at the boundary.
//
// These exist because the obvious `Number(c.req.query('limit') ?? 50)` is wrong
// for anything a client actually sends: `Number('abc')` is NaN, `Math.min(NaN,
// 100)` is NaN, and that reaches the query builder as `LIMIT NaN` — so a
// malformed query string fails as a 500 from Postgres instead of being clamped
// here. Out-of-range and negative values get the same treatment: coerce to
// something sane rather than trust it.

import { count, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { getDb } from '../db/connection.js';

// `Number` rather than `parseInt`, and `isSafeInteger` rather than `isFinite`:
// parseInt stops at the first character it doesn't like, so `'1e400'` becomes 1
// and `'50abc'` becomes 50 — it accepts junk by reading a prefix of it. Whole-
// string coercion rejects both, and the safe-integer check also catches values
// too large to survive the trip through SQL.
export function parseLimit(raw: string | undefined, fallback: number, max: number): number {
  const value = Number(raw);
  if (raw === undefined || !Number.isSafeInteger(value) || value < 1) return fallback;
  return Math.min(value, max);
}

export function parseOffset(raw: string | undefined): number {
  const value = Number(raw);
  if (raw === undefined || !Number.isSafeInteger(value) || value < 0) return 0;
  return value;
}

// Count every row of a table (optionally filtered) — the `total` beside a page.
// Drizzle returns a one-row result set; this unwraps it so list handlers read as
// `total: await countOf(x)`.
export async function countOf(table: PgTable, where?: SQL): Promise<number> {
  const [row] = await getDb().select({ value: count() }).from(table).where(where);
  return row?.value ?? 0;
}
