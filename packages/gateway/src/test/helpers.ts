import { newId } from '@confer/shared';
import * as jose from 'jose';
import postgres from 'postgres';
import { app } from '../app.js';
import { getDb } from '../db/connection.js';
import { users } from '../db/schema.js';

// Dedicated admin connection for truncation/teardown, separate from the
// connection the app uses through getDb().
const adminSql = postgres(process.env.DATABASE_URL ?? '', { max: 1 });

export async function resetDb(): Promise<void> {
  const rows = await adminSql<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  const names = rows.map((r) => `"${r.tablename}"`).join(', ');
  if (names) {
    await adminSql.unsafe(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
  }
}

export async function mintToken(sub: string, username: string): Promise<string> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  return new jose.SignJWT({ username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer(process.env.JWT_ISSUER ?? 'confer')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);
}

export interface SeededUser {
  id: string;
  username: string;
  did: string;
  token: string;
}

export async function seedUser(username?: string): Promise<SeededUser> {
  const id = newId();
  const name = username ?? `u${id.slice(-10).toLowerCase()}`;
  const did = `did:web:localhost:agents:${name}`;
  await getDb().insert(users).values({ id, username: name, did });
  return { id, username: name, did, token: await mintToken(id, name) };
}

let ipCounter = 0;

// Unique x-forwarded-for per call so the in-memory rate limiter (keyed by
// ip:path) never collides across unrelated tests. Pass a fixed `ip` to
// deliberately exercise rate limiting.
export function headers(opts: { token?: string; ip?: string } = {}): Record<string, string> {
  const h: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': opts.ip ?? `test-ip-${ipCounter++}`,
  };
  if (opts.token) h.Authorization = `Bearer ${opts.token}`;
  return h;
}

export function apiRequest(path: string, init?: RequestInit): Promise<Response> {
  return Promise.resolve(app.request(path, init));
}

// Intercepts external HTTP calls (embedding API, LLM API, DID resolution) while
// letting our own infra (Qdrant, MinIO) pass through. The handler returns a
// Response to stub a request, or undefined to delegate to the real fetch.
// Returns a restore function.
export function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | undefined,
): () => void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return handler(url, init) ?? realFetch(input, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

interface SendOpts {
  token?: string;
  ip?: string;
  body?: unknown;
}

function send(method: string, path: string, opts: SendOpts = {}): Promise<Response> {
  return apiRequest(path, {
    method,
    headers: headers({ token: opts.token, ip: opts.ip }),
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

export const get = (path: string, opts?: SendOpts) => send('GET', path, opts);
export const post = (path: string, opts?: SendOpts) => send('POST', path, opts);
export const put = (path: string, opts?: SendOpts) => send('PUT', path, opts);
export const patch = (path: string, opts?: SendOpts) => send('PATCH', path, opts);
export const del = (path: string, opts?: SendOpts) => send('DELETE', path, opts);
