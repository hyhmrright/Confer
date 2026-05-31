import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { sessions, users } from '../db/schema.js';
import { apiRequest, headers, resetDb } from '../test/helpers.js';

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
const LOGOUT = '/api/v1/auth/logout';

type Body = Record<string, unknown>;

function registerBody(over: Body = {}): Body {
  return { username: 'alice', password: 'password123', display_name: 'Alice', ...over };
}

function post(path: string, body: Body, opts: { token?: string; ip?: string } = {}) {
  return apiRequest(path, { method: 'POST', headers: headers(opts), body: JSON.stringify(body) });
}

beforeEach(resetDb);

describe('POST /auth/register', () => {
  test('creates a user, hashes the password, and returns tokens', async () => {
    const res = await post(REGISTER, registerBody());
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.access_token).toBeTruthy();
    expect(json.refresh_token).toBeTruthy();
    expect(json.user).toMatchObject({ username: 'alice', display_name: 'Alice' });
    expect(json.user.did).toBe('did:web:localhost:agents:alice');

    const [row] = await getDb().select().from(users).where(eq(users.username, 'alice'));
    expect(row?.password_hash).toBeTruthy();
    expect(row?.password_hash).not.toBe('password123'); // never stored in plaintext
  });

  test('rejects a duplicate username with 409', async () => {
    await post(REGISTER, registerBody());
    const res = await post(REGISTER, registerBody({ display_name: 'Other' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('username_taken');
  });

  test('rejects invalid input with 400', async () => {
    const res = await post(REGISTER, { username: 'ab', password: 'short' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('validation_error');
  });

  test('enforces the per-ip registration rate limit', async () => {
    const ip = 'rl-register';
    for (let i = 0; i < 3; i++) {
      const ok = await post(REGISTER, registerBody({ username: `rluser_${i}` }), { ip });
      expect(ok.status).toBe(201);
    }
    const blocked = await post(REGISTER, registerBody({ username: 'rluser_3' }), { ip });
    expect(blocked.status).toBe(429);
  });
});

describe('POST /auth/login', () => {
  test('logs in with correct credentials and records a session', async () => {
    await post(REGISTER, registerBody());
    const res = await post(LOGIN, {
      username: 'alice',
      password: 'password123',
      device_id: 'dev-1',
      device_info: { platform: 'macos' },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).access_token).toBeTruthy();

    const recorded = await getDb().select().from(sessions);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.device_id).toBe('dev-1');
  });

  test('rejects a wrong password with 401', async () => {
    await post(REGISTER, registerBody());
    const res = await post(LOGIN, { username: 'alice', password: 'wrongpass', device_id: 'dev-1' });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('invalid_credentials');
  });

  test('rejects an unknown user with 401', async () => {
    const res = await post(LOGIN, {
      username: 'ghost',
      password: 'password123',
      device_id: 'dev-1',
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/refresh', () => {
  test('issues new tokens for a valid refresh token', async () => {
    const { refresh_token } = await (await post(REGISTER, registerBody())).json();
    const res = await post(REFRESH, { refresh_token });
    expect(res.status).toBe(200);
    expect((await res.json()).access_token).toBeTruthy();
  });

  test('rejects an invalid refresh token with 401', async () => {
    const res = await post(REFRESH, { refresh_token: 'garbage' });
    expect(res.status).toBe(401);
  });

  test('rejects a missing refresh token with 400', async () => {
    const res = await post(REFRESH, {});
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/logout', () => {
  test('requires authentication', async () => {
    const res = await post(LOGOUT, {});
    expect(res.status).toBe(401);
  });

  test('succeeds with a valid bearer token', async () => {
    const { access_token } = await (await post(REGISTER, registerBody())).json();
    const res = await post(LOGOUT, {}, { token: access_token });
    expect(res.status).toBe(200);
  });
});
