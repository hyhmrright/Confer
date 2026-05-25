import { createMiddleware } from 'hono/factory';
import { AppError } from '@confer/shared';

const counters = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(limit: number, windowMs: number) {
  return createMiddleware(async (c, next) => {
    const ip = c.req.header('x-forwarded-for') ?? 'unknown';
    const key = `${ip}:${c.req.path}`;
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
