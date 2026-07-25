import { AppError } from '@confer/shared';
import type { Context, Env } from 'hono';
import { createMiddleware } from 'hono/factory';

const counters = new Map<string, { count: number; resetAt: number }>();

// Resolve the real client IP behind nginx. `x-real-ip` is set (overwritten, not
// appended) by our nginx on the /api/, /a2a/ and /ws locations, so a client
// can't forge it. The whole `x-forwarded-for` header is client-controllable, so
// we never trust its leading entries — nginx appends the real peer last, so the
// last hop is the only trustworthy one.
function clientIp(c: Context): string {
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
