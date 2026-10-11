import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { auditLog, users } from '../db/schema.js';
import { totpCode, totpStep } from '../lib/totp.js';
import { get, post, resetDb, seedUser } from '../test/helpers.js';

const PASSWORD = 'correct horse battery';

beforeEach(resetDb);

// Through the real route, so the account has the password hash, session and
// tokens production gives it rather than a fixture's idea of them.
async function register(): Promise<{ username: string; token: string; refresh: string }> {
  const username = `u${Math.random().toString(36).slice(2, 10)}`;
  const res = await post('/api/v1/auth/register', {
    body: { username, password: PASSWORD, device_id: 'test-device' },
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  return { username, token: body.access_token, refresh: body.refresh_token };
}

const login = (username: string, password: string, extra: Record<string, string> = {}) =>
  post('/api/v1/auth/login', {
    body: { username, password, device_id: 'test-device', ...extra },
  });

describe('changing the password', () => {
  test('needs the current one, and then only the new one signs in', async () => {
    const me = await register();
    const wrong = await post('/api/v1/auth/password', {
      token: me.token,
      body: { current_password: 'nope', new_password: 'a brand new one' },
    });
    expect(wrong.status).toBe(401);

    const ok = await post('/api/v1/auth/password', {
      token: me.token,
      body: { current_password: PASSWORD, new_password: 'a brand new one' },
    });
    expect(ok.status).toBe(200);
    expect((await login(me.username, PASSWORD)).status).toBe(401);
    expect((await login(me.username, 'a brand new one')).status).toBe(200);
  });

  test('signs out every other device and keeps this one', async () => {
    const me = await register();
    const other = await (await login(me.username, PASSWORD)).json();

    await post('/api/v1/auth/password', {
      token: me.token,
      body: { current_password: PASSWORD, new_password: 'a brand new one' },
    });

    const theirs = await post('/api/v1/auth/refresh', {
      body: { refresh_token: other.refresh_token },
    });
    expect(theirs.status).toBe(401);
    const mine = await post('/api/v1/auth/refresh', { body: { refresh_token: me.refresh } });
    expect(mine.status).toBe(200);
  });

  test('is audited', async () => {
    const me = await register();
    await post('/api/v1/auth/password', {
      token: me.token,
      body: { current_password: PASSWORD, new_password: 'a brand new one' },
    });
    const rows = await getDb()
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.action, 'account.password_changed'));
    expect(rows).toHaveLength(1);
  });

  test('refuses a new password shorter than registration allows', async () => {
    const me = await register();
    const res = await post('/api/v1/auth/password', {
      token: me.token,
      body: { current_password: PASSWORD, new_password: 'short' },
    });
    expect(res.status).toBe(400);
  });
});

describe('two-step sign-in', () => {
  async function turnOn(me: { token: string }) {
    const setup = await (
      await post('/api/v1/auth/2fa/setup', { token: me.token, body: {} })
    ).json();
    expect(setup.otpauth_uri).toContain(`secret=${setup.secret}`);
    const step = totpStep(Date.now());
    const enabled = await post('/api/v1/auth/2fa/enable', {
      token: me.token,
      body: { password: PASSWORD, code: totpCode(setup.secret, step) },
    });
    expect(enabled.status).toBe(200);
    return {
      secret: setup.secret as string,
      step,
      recovery: (await enabled.json()).recovery_codes as string[],
    };
  }

  test('setup alone changes nothing; enabling needs the password and a code', async () => {
    const me = await register();
    const setup = await (
      await post('/api/v1/auth/2fa/setup', { token: me.token, body: {} })
    ).json();
    expect((await login(me.username, PASSWORD)).status).toBe(200);

    const code = totpCode(setup.secret, totpStep(Date.now()));
    const enable = (body: Record<string, string>) =>
      post('/api/v1/auth/2fa/enable', { token: me.token, body });
    expect(
      (await enable({ password: PASSWORD, code: code === '000000' ? '111111' : '000000' })).status,
    ).toBe(401);
    // A stolen token alone must not be able to put an attacker's app in place.
    expect((await enable({ password: 'not it', code })).status).toBe(401);
    expect((await enable({ password: PASSWORD, code })).status).toBe(200);
  });

  test('turning it on signs out every other device', async () => {
    const me = await register();
    const other = await (await login(me.username, PASSWORD)).json();
    await turnOn(me);
    const theirs = await post('/api/v1/auth/refresh', {
      body: { refresh_token: other.refresh_token },
    });
    expect(theirs.status).toBe(401);
    const mine = await post('/api/v1/auth/refresh', { body: { refresh_token: me.refresh } });
    expect(mine.status).toBe(200);
  });

  // The login limit is per IP; this one follows the account across addresses.
  test('five wrong codes lock code attempts for the account, right code included', async () => {
    const me = await register();
    const { secret, step } = await turnOn(me);
    const right = totpCode(secret, step + 1);
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect((await login(me.username, PASSWORD, { totp_code: wrong })).status).toBe(401);
    }
    expect((await login(me.username, PASSWORD, { totp_code: right })).status).toBe(429);
  });

  test('with it on, changing the password needs a second factor too', async () => {
    const me = await register();
    const { recovery } = await turnOn(me);
    const change = (extra: Record<string, string>) =>
      post('/api/v1/auth/password', {
        token: me.token,
        body: { current_password: PASSWORD, new_password: 'a brand new one', ...extra },
      });
    expect((await (await change({})).json()).error.code).toBe('totp_required');
    expect((await change({ recovery_code: recovery[2] as string })).status).toBe(200);
  });

  test('an admin can turn it off for someone locked out, but not for themselves', async () => {
    const me = await register();
    await turnOn(me);
    const admin = await seedUser(undefined, { role: 'admin' });
    const [row] = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, me.username));
    const reset = (id: string) =>
      post(`/api/v1/admin/users/${id}/reset-2fa`, { token: admin.token, body: {} });

    expect((await reset(admin.id)).status).toBe(400);
    expect((await reset(row?.id as string)).status).toBe(200);
    expect((await login(me.username, PASSWORD)).status).toBe(200);
    const audited = await getDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'admin.user.reset_2fa'));
    expect(audited).toHaveLength(1);
  });

  test('once on, the password alone is not enough, and the secret is stored sealed', async () => {
    const me = await register();
    const { secret, step } = await turnOn(me);

    const res = await login(me.username, PASSWORD);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('totp_required');

    // The code from enabling has been spent; the next step's has not.
    expect((await login(me.username, PASSWORD, { totp_code: totpCode(secret, step) })).status).toBe(
      401,
    );
    expect(
      (await login(me.username, PASSWORD, { totp_code: totpCode(secret, step + 1) })).status,
    ).toBe(200);
    // …and now it has.
    expect(
      (await login(me.username, PASSWORD, { totp_code: totpCode(secret, step + 1) })).status,
    ).toBe(401);

    const [row] = await getDb()
      .select({ sealed: users.totp_secret_json })
      .from(users)
      .where(eq(users.username, me.username));
    expect(JSON.stringify(row?.sealed)).not.toContain(secret);
  });

  test('a wrong password is refused before a code is even asked for', async () => {
    const me = await register();
    await turnOn(me);
    const res = await login(me.username, 'wrong password');
    expect((await res.json()).error.code).toBe('invalid_credentials');
  });

  test('each recovery code signs in exactly once', async () => {
    const me = await register();
    const { recovery } = await turnOn(me);
    expect(recovery).toHaveLength(10);
    const code = recovery[0] as string;

    // Retyped from paper: case and dash do not matter.
    expect(
      (await login(me.username, PASSWORD, { recovery_code: code.toUpperCase().replace('-', '') }))
        .status,
    ).toBe(200);
    expect((await login(me.username, PASSWORD, { recovery_code: code })).status).toBe(401);

    const status = await (await get('/api/v1/auth/2fa', { token: me.token })).json();
    expect(status).toEqual({ enabled: true, recovery_codes_left: 9 });
  });

  test('turning it off takes the password and a second factor', async () => {
    const me = await register();
    const { recovery } = await turnOn(me);

    const passwordOnly = await post('/api/v1/auth/2fa/disable', {
      token: me.token,
      body: { password: PASSWORD },
    });
    expect(passwordOnly.status).toBe(401);

    const off = await post('/api/v1/auth/2fa/disable', {
      token: me.token,
      body: { password: PASSWORD, recovery_code: recovery[1] },
    });
    expect(off.status).toBe(200);
    expect((await login(me.username, PASSWORD)).status).toBe(200);
  });

  test('requires a signed-in caller', async () => {
    expect((await post('/api/v1/auth/2fa/setup', { body: {} })).status).toBe(401);
    expect((await get('/api/v1/auth/2fa')).status).toBe(401);
  });
});
