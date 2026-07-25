// In-process replay-nonce cache for A2A signature verification.
//
// Mirrors the module-level `Map` pattern already used by `middleware/rate-limit.ts`:
// single-instance, no external store. Redis is dead infra in this deployment and
// a Postgres nonce table (unique constraint + a write on every inbound request +
// an expiry sweep + a migration) is over-built for MVP A2A volume. A verified
// signature only needs to be remembered for the clock-skew window — anything
// older is already rejected by the verifier's skew check — so entries are
// short-lived and the map stays small.
//
// Limitation: single-instance only, and the hard size cap could theoretically
// evict a still-valid nonce under extreme load. If this ever goes multi-instance
// or high-volume, the documented upgrade is a `used_nonces(nonce_hash pk,
// expires_at)` Postgres table with a unique constraint.

interface NonceEntry {
  expiresAt: number;
}

const nonces = new Map<string, NonceEntry>();

// Memory safety valve: an unbounded map is a DoS vector. At the cap we drop the
// oldest-inserted entry (Map preserves insertion order), which under normal load
// is also the soonest to expire.
const MAX_ENTRIES = 100_000;

// Full sweeps are O(n), so bound their frequency rather than sweeping on every
// insert. Lazy per-key expiry in `hasNonce` covers correctness between sweeps.
const SWEEP_INTERVAL_MS = 60_000;
let lastSweepAt = 0;

function sweepExpired(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, entry] of nonces) {
    if (entry.expiresAt <= now) {
      nonces.delete(key);
    }
  }
}

// True if `key` was recorded and has not yet expired. Expired entries are
// dropped on read so a stale hit never masks a legitimate fresh request.
export function hasNonce(key: string): boolean {
  const entry = nonces.get(key);
  if (!entry) return false;
  if (entry.expiresAt <= Date.now()) {
    nonces.delete(key);
    return false;
  }
  return true;
}

// Record `key` as seen for `ttlMs`. Callers pass the clock-skew window as the
// TTL, since the verifier rejects anything older regardless.
export function addNonce(key: string, ttlMs: number): void {
  const now = Date.now();
  sweepExpired(now);
  if (nonces.size >= MAX_ENTRIES) {
    const oldest = nonces.keys().next().value;
    if (oldest !== undefined) nonces.delete(oldest);
  }
  nonces.set(key, { expiresAt: now + ttlMs });
}

// Test-only: drop all remembered nonces so cases sharing the process don't leak
// replay state into one another.
export function clearNonceCache(): void {
  nonces.clear();
  lastSweepAt = 0;
}
