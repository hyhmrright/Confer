import { monotonicFactory } from 'ulid';

/**
 * ULIDs that strictly increase within this process.
 *
 * Plain `ulid()` gives every id a fresh random suffix, so two minted inside one
 * millisecond sort at RANDOM — and rows written back to back land in the same
 * millisecond routinely. Every query that pages or windows by message id had
 * quietly assumed insertion order, and none of them got it; the symptom was a
 * history window that silently dropped its newest message, and a page of a
 * conversation that could skip one.
 *
 * `created_at` cannot stand in for it either: `now()` is the TRANSACTION
 * timestamp, identical for every row one transaction writes.
 *
 * Monotonicity is per-process, which is all this needs. The gateway is
 * single-instance by design (see docs/02-architecture.md), and ids minted by
 * different processes still order by their millisecond.
 */
const nextId = monotonicFactory();

export function newId(): string {
  return nextId();
}

const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isValidId(id: string): boolean {
  return ULID_REGEX.test(id);
}
