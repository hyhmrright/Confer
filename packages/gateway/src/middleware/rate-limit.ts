import { AppError } from '@confer/shared';
import type { Context, Env } from 'hono';
import { createMiddleware } from 'hono/factory';
import { clientIp } from '../lib/client-ip.js';

// Process-local, so the effective limit is per-replica: N replicas allow N times
// the configured rate. One of the three things that pin the gateway to a single
// replica (with `lib/nonce-cache.ts` and `ws/handler.ts`) — docs/02-architecture.md.
const counters = new Map<string, { count: number; resetAt: number }>();

// A counter is dead the moment its window closes, but nothing reads it again
// unless the same key returns — so without a sweep the map grows once per
// distinct ip:path and never shrinks. Sweeps are O(n), so bound their frequency
// rather than running one per request; the per-key expiry check below keeps
// correctness exact in between.
const SWEEP_INTERVAL_MS = 60_000;
let lastSweepAt = 0;

function sweepExpired(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, entry] of counters) {
    if (now > entry.resetAt) {
      counters.delete(key);
    }
  }
}

interface RateLimitOptions<E extends Env> {
  // Build the throttle key from the request. When provided the key is used
  // as-is (the caller owns any namespacing); otherwise the default keys by
  // resolved client IP and request path.
  keyBy?: (c: Context<E>) => string;
}

export function rateLimit<E extends Env = Env>(
  limit: number,
  windowMs: number,
  opts?: RateLimitOptions<E>,
) {
  return createMiddleware<E>(async (c, next) => {
    const key = opts?.keyBy ? opts.keyBy(c) : `${clientIp(c)}:${c.req.path}`;
    const now = Date.now();
    sweepExpired(now);

    let entry = counters.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      counters.set(key, entry);
    }

    entry.count++;
    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      throw new AppError('rate_limited', 'Too many requests', 429);
    }

    await next();
  });
}
