import { newId } from '@confer/shared';
import * as jose from 'jose';
import postgres from 'postgres';
import { app } from '../app.js';
import { getDb } from '../db/connection.js';
import { sessions, users } from '../db/schema.js';
import { settleDetached } from '../lib/background.js';

// Dedicated admin connection for truncation/teardown, separate from the
// connection the app uses through getDb().
const adminSql = postgres(process.env.DATABASE_URL ?? '', { max: 1 });

export async function resetDb(): Promise<void> {
  // Drain first. A turn detaches its memory extraction, an approval detaches
  // the agent turn it resumes, an upload detaches ingestion — all of them write
  // here, and the previous test returned without waiting. TRUNCATE takes an
  // ACCESS EXCLUSIVE lock on every table, so truncating over one of those
  // writes deadlocks against it (Postgres 40P01, reported after its 1s
  // deadlock_timeout) or queues behind it until the test times out. See
  // `lib/background.ts`.
  await settleDetached();

  const rows = await adminSql<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  const names = rows.map((r) => `"${r.tablename}"`).join(', ');
  if (names) {
    await adminSql.unsafe(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
  }
}

// Mint a token with the claims `/auth/login` mints. `typ` and `sid` are not
// optional extras: bearer auth admits only `typ: 'access'`, and the WebSocket
// upgrade additionally requires `sid` to name a live session. A helper that
// omits them signs a token production never issues, which is how a fixture ends
// up testing nothing — the `sid` in particular is the whole of session
// revocation.
export async function mintToken(
  sub: string,
  username: string,
  opts: { sid?: string; typ?: string; expiresIn?: string } = {},
): Promise<string> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  return new jose.SignJWT({ username, sid: opts.sid, typ: opts.typ ?? 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer(process.env.JWT_ISSUER ?? 'confer')
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '15m')
    .sign(secret);
}

export interface SeededUser {
  id: string;
  username: string;
  did: string;
  token: string;
  /** The session the token belongs to, as a real row — logout/disable delete it. */
  sessionId: string;
}

export async function seedUser(
  username?: string,
  opts: { role?: 'member' | 'admin' } = {},
): Promise<SeededUser> {
  const id = newId();
  const name = username ?? `u${id.slice(-10).toLowerCase()}`;
  const did = `did:web:localhost:agents:${name}`;
  const sessionId = newId();
  await getDb()
    .insert(users)
    .values({ id, username: name, did, role: opts.role ?? 'member' });
  await getDb()
    .insert(sessions)
    .values({
      id: sessionId,
      user_id: id,
      device_id: `test-${sessionId.slice(-8)}`,
      expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });
  return {
    id,
    username: name,
    did,
    sessionId,
    token: await mintToken(id, name, { sid: sessionId }),
  };
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
// `input` is passed through as the third argument because a caller may hand
// fetch a fully-built Request — outbound A2A signs one — and then the body is
// on the Request, not on `init`. Reading `init.body` there yields undefined.
export function mockFetch(
  handler: (url: string, init?: RequestInit, input?: RequestInfo | URL) => Response | undefined,
): () => void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return handler(url, init, input) ?? realFetch(input, init);
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
