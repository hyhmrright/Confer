import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from './error-handler.js';
import { rateLimit } from './rate-limit.js';

// Each test mounts on a unique path so the module-level counters map (keyed by
// `${ip}:${path}`) never collides across tests.
function appAt(path: string, limit: number, windowMs: number): Hono {
  const app = new Hono();
  app.onError(errorHandler);
  app.use(path, rateLimit(limit, windowMs));
  app.get(path, (c) => c.json({ ok: true }));
  return app;
}

function req(app: Hono, path: string, ip = '1.2.3.4'): Promise<Response> {
  return Promise.resolve(app.request(path, { headers: { 'x-forwarded-for': ip } }));
}

describe('rateLimit', () => {
  test('allows requests up to the limit then 429s with Retry-After', async () => {
    const path = '/rl-a';
    const app = appAt(path, 2, 60_000);

    expect((await req(app, path)).status).toBe(200);
    expect((await req(app, path)).status).toBe(200);

    const limited = await req(app, path);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    const body = await limited.json();
    expect(body.error.code).toBe('rate_limited');
  });

  test('counts each client ip independently', async () => {
    const path = '/rl-b';
    const app = appAt(path, 1, 60_000);

    expect((await req(app, path, 'a.a.a.a')).status).toBe(200);
    expect((await req(app, path, 'a.a.a.a')).status).toBe(429);
    // A different ip still has its full allowance.
    expect((await req(app, path, 'b.b.b.b')).status).toBe(200);
  });

  test('resets the window after it elapses', async () => {
    const path = '/rl-c';
    const app = appAt(path, 1, 30); // 30ms window

    expect((await req(app, path, 'c.c.c.c')).status).toBe(200);
    expect((await req(app, path, 'c.c.c.c')).status).toBe(429);

    await new Promise((r) => setTimeout(r, 40));
    expect((await req(app, path, 'c.c.c.c')).status).toBe(200);
  });

  test('buckets missing x-forwarded-for under a shared "unknown" key', async () => {
    const path = '/rl-d';
    const app = appAt(path, 1, 60_000);
    // No x-forwarded-for header => both requests fall in the same "unknown" bucket.
    expect((await app.request(path)).status).toBe(200);
    expect((await app.request(path)).status).toBe(429);
  });
});
