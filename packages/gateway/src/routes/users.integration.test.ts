import { beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { agents, users } from '../db/schema.js';
import { type SeededUser, del, get, patch, put, resetDb, seedUser } from '../test/helpers.js';

let user: SeededUser;

async function seedAgent(userId: string): Promise<void> {
  await getDb()
    .insert(agents)
    .values({
      id: newId(),
      user_id: userId,
      did: `${`did:web:localhost:agents:${userId.slice(-6)}`}:agent`,
    });
}

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

describe('users /me', () => {
  test('requires authentication', async () => {
    expect((await get('/api/v1/users/me')).status).toBe(401);
  });

  test('returns the authenticated profile', async () => {
    const res = await get('/api/v1/users/me', { token: user.token });
    expect(res.status).toBe(200);
    expect((await res.json()).user).toMatchObject({ id: user.id, username: user.username });
  });

  test('updates allowed profile fields', async () => {
    await patch('/api/v1/users/me', { token: user.token, body: { display_name: 'Renamed' } });
    const res = await get('/api/v1/users/me', { token: user.token });
    expect((await res.json()).user.display_name).toBe('Renamed');
  });
});

describe('agent LLM keys', () => {
  test('stores keys encrypted and never returns the secret', async () => {
    const put1 = await put('/api/v1/agents/me/llm-keys', {
      token: user.token,
      body: { provider: 'openai', api_key: 'sk-super-secret' },
    });
    expect(put1.status).toBe(200);

    const listed = await get('/api/v1/agents/me/llm-keys', { token: user.token });
    const { keys } = await listed.json();
    expect(keys.find((k: { provider: string }) => k.provider === 'openai').configured).toBe(true);
    // the listing exposes only flags, never the key material
    expect(JSON.stringify(keys)).not.toContain('sk-super-secret');

    const [row] = await getDb()
      .select({ llm_keys_json: users.llm_keys_json })
      .from(users)
      .where(eq(users.id, user.id));
    const stored = row?.llm_keys_json as Record<
      string,
      { ciphertext: string; iv: string; tag: string }
    >;
    expect(stored.openai).toMatchObject({
      ciphertext: expect.any(String),
      iv: expect.any(String),
      tag: expect.any(String),
    });
    expect(JSON.stringify(stored.openai)).not.toContain('sk-super-secret');
  });

  test('removes a stored key', async () => {
    await put('/api/v1/agents/me/llm-keys', {
      token: user.token,
      body: { provider: 'openai', api_key: 'sk-x' },
    });
    await del('/api/v1/agents/me/llm-keys/openai', { token: user.token });
    const listed = await get('/api/v1/agents/me/llm-keys', { token: user.token });
    const { keys } = await listed.json();
    expect(keys.find((k: { provider: string }) => k.provider === 'openai').configured).toBe(false);
  });

  test('rejects an unknown provider', async () => {
    const res = await put('/api/v1/agents/me/llm-keys', {
      token: user.token,
      body: { provider: 'bogus', api_key: 'x' },
    });
    expect(res.status).toBe(400);
  });
});

describe('agents /me', () => {
  test('returns the agent and updates its visibility', async () => {
    await seedAgent(user.id);
    const before = await get('/api/v1/agents/me', { token: user.token });
    expect((await before.json()).agent.is_public).toBe(false);

    await patch('/api/v1/agents/me', { token: user.token, body: { is_public: true } });
    const after = await get('/api/v1/agents/me', { token: user.token });
    expect((await after.json()).agent.is_public).toBe(true);
  });
});
