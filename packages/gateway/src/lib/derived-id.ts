import { createHash } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A deterministic ULID-shaped id derived from the parts that identify a row.
 *
 * Where an id can be derived there is nothing to race over: concurrent creators
 * collide on the primary key instead of each inserting a row for the same
 * thing. Both callers rely on that — consult threads (one per user+peer) and
 * inbound A2A threads (one per user+peer+peer thread id).
 *
 * Parts are joined with ':' before hashing, so every caller must lead with a
 * prefix no other caller uses. Only the LAST part may be untrusted or of
 * variable width: ':' is not escaped, so two different part lists could
 * otherwise join to the same string, and the A2A caller's last part is a thread
 * id the peer chooses. Everything before it there is a 26-char id, which leaves
 * no ambiguity to exploit.
 */
export function derivedId(...parts: string[]): string {
  const hash = createHash('sha256').update(parts.join(':')).digest();
  let n = 0n;
  for (let i = 0; i < 16; i++) n = (n << 8n) | BigInt(hash[i] ?? 0);
  let out = '';
  for (let i = 0; i < 26; i++) {
    out = CROCKFORD[Number(n & 31n)] + out;
    n >>= 5n;
  }
  return out;
}
