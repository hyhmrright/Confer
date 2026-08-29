import type { Context } from 'hono';

// The one answer to "who sent this request", for every caller that needs it.
//
// `x-forwarded-for` is a client-appendable list: a caller can send
// `x-forwarded-for: 1.2.3.4` and nginx will append the real peer AFTER it, so
// the leading entries are attacker-chosen and only the last hop is ours. Our
// nginx also sets `x-real-ip` (overwritten, not appended) on the /api/, /a2a/
// and /ws locations, which is why that is preferred outright.
//
// This lived inside `middleware/rate-limit.ts`, correct and well-argued, while
// the audit log independently reached for `x-forwarded-for.split(',')[0]` — the
// exact value the comment there warns is forgeable. Two readings of one header
// in one codebase is one too many, and the half that got it wrong was the one
// whose entire purpose is attribution.
export function clientIp(c: Context): string {
  const realIp = c.req.header('x-real-ip')?.trim();
  if (realIp) return realIp;

  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',');
    const last = hops[hops.length - 1]?.trim();
    if (last) return last;
  }

  return 'unknown';
}
