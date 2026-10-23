import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { apiTokens, users } from '../db/schema.js';
import { del, get, post, put, resetDb, type SeededUser, seedUser } from '../test/helpers.js';

let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

async function mint(name = 'ci'): Promise<{ id: string; token: string }> {
  const res = await post('/api/v1/tokens', { token: user.token, body: { name } });
  expect(res.status).toBe(201);
  return (await res.json()).token;
}

describe('personal API tokens', () => {
  test('the token is shown once; the list never carries it or its hash', async () => {
    const minted = await mint('laptop script');
    expect(minted.token).toStartWith('cfr_');

    const { tokens } = await (await get('/api/v1/tokens', { token: user.token })).json();
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ name: 'laptop script', prefix: minted.token.slice(0, 12) });
    expect(JSON.stringify(tokens)).not.toContain(minted.token);
    expect(tokens[0].token_hash).toBeUndefined();
  });

  test('authenticates as its owner, and marks itself used', async () => {
    const { token } = await mint();
    await post('/api/v1/conversations', { token: user.token, body: { name: 'mine' } });

    const res = await get('/api/v1/conversations', { token });
    expect(res.status).toBe(200);
    expect((await res.json()).conversations).toHaveLength(1);

    // last_used_at is written in the background.
    for (let i = 0; i < 50; i++) {
      const [row] = await getDb().select().from(apiTokens);
      if (row?.last_used_at) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('last_used_at never written');
  });

  // A leaked token may run the owner's errands; it may not decide for them,
  // change their credentials, mint more of itself, or act as an admin.
  test('is refused wherever only the person may act', async () => {
    const { token } = await mint();
    const refused = [
      await post('/api/v1/tokens', { token, body: { name: 'another' } }),
      await get('/api/v1/tokens', { token }),
      await post('/api/v1/auth/logout', { token, body: {} }),
      await post('/api/v1/auth/password', {
        token,
        body: { current_password: 'x', new_password: 'yyyyyyyy' },
      }),
      await post('/api/v1/auth/2fa/setup', { token, body: {} }),
      await post('/api/v1/permissions/01HZZZZZZZZZZZZZZZZZZZZZZZ/decide', {
        token,
        body: { decision: 'allow_once', scope: 'peer' },
      }),
      await put('/api/v1/agents/me/llm-keys', {
        token,
        body: { provider: 'openai', api_key: 'k' },
      }),
    ];
    for (const res of refused) {
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('session_required');
    }
  });

  test('stops working once revoked, expired, or its owner is disabled', async () => {
    const revoked = await mint('a');
    expect((await del(`/api/v1/tokens/${revoked.id}`, { token: user.token })).status).toBe(200);
    expect((await get('/api/v1/conversations', { token: revoked.token })).status).toBe(401);

    const expired = await mint('b');
    await getDb()
      .update(apiTokens)
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where(eq(apiTokens.id, expired.id));
    expect((await get('/api/v1/conversations', { token: expired.token })).status).toBe(401);

    const live = await mint('c');
    await getDb().update(users).set({ status: 'disabled' }).where(eq(users.id, user.id));
    expect((await get('/api/v1/conversations', { token: live.token })).status).toBe(401);
  });

  test('an owner can only see and revoke their own', async () => {
    const mine = await mint();
    const other = await seedUser();
    expect((await del(`/api/v1/tokens/${mine.id}`, { token: other.token })).status).toBe(404);
    expect((await (await get('/api/v1/tokens', { token: other.token })).json()).tokens).toEqual([]);
  });

  test('takes an expiry in days, and caps how many one owner holds', async () => {
    const res = await post('/api/v1/tokens', {
      token: user.token,
      body: { name: 'short', expires_in_days: 7 },
    });
    const expires = new Date((await res.json()).token.expires_at).getTime();
    expect(Math.abs(expires - (Date.now() + 7 * 86_400_000))).toBeLessThan(60_000);

    for (let i = 1; i < 20; i++) await mint(`t${i}`);
    const over = await post('/api/v1/tokens', { token: user.token, body: { name: 'one more' } });
    expect(over.status).toBe(409);
  });
});
