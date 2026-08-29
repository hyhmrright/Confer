import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { agents, users } from '../db/schema.js';
import {
  del,
  get,
  mockFetch,
  patch,
  put,
  resetDb,
  type SeededUser,
  seedUser,
} from '../test/helpers.js';

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

  // A local runtime's stored value is an address the gateway will dial, so it
  // has to be one — and only over http(s).
  test('requires a local runtime slot to hold an http(s) URL', async () => {
    for (const api_key of ['not-a-url', 'file:///etc/passwd', 'sk-looks-like-a-key']) {
      const res = await put('/api/v1/agents/me/llm-keys', {
        token: user.token,
        body: { provider: 'ollama', api_key },
      });
      expect(res.status).toBe(400);
    }

    const ok = await put('/api/v1/agents/me/llm-keys', {
      token: user.token,
      body: { provider: 'ollama', api_key: 'http://host.docker.internal:11434' },
    });
    expect(ok.status).toBe(200);
  });
});

/*
  Every one of these used to answer `{ models: [] }`, and the settings UI read
  that as "this provider has no models" and quietly substituted a hand-written
  list of model names. The reason is the point of the endpoint now: it is what
  lets the UI tell the owner whether to add a key, replace one, or wait.
*/
describe('agent model listing', () => {
  let restoreFetch: (() => void) | undefined;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
  });

  async function models(provider: string): Promise<{ models: { id: string }[]; error?: string }> {
    const res = await get(`/api/v1/agents/me/llm-keys/${provider}/models`, { token: user.token });
    expect(res.status).toBe(200);
    return res.json();
  }

  test('rejects a provider that is not in the catalogue', async () => {
    const res = await get('/api/v1/agents/me/llm-keys/bogus/models', { token: user.token });
    expect(res.status).toBe(400);
  });

  test('reports a missing key rather than an empty list', async () => {
    expect(await models('openai')).toEqual({ models: [], error: 'no_key' });
  });

  test("returns the vendor's own list", async () => {
    await put('/api/v1/agents/me/llm-keys', {
      token: user.token,
      body: { provider: 'openai', api_key: 'sk-x' },
    });
    restoreFetch = mockFetch((url) =>
      url === 'https://api.openai.com/v1/models'
        ? Response.json({ data: [{ id: 'gpt-4o' }, { id: 'o3' }] })
        : undefined,
    );
    expect(await models('openai')).toEqual({ models: [{ id: 'gpt-4o' }, { id: 'o3' }] });
  });

  test('reports a rejected key separately from an unreachable vendor', async () => {
    await put('/api/v1/agents/me/llm-keys', {
      token: user.token,
      body: { provider: 'openai', api_key: 'sk-wrong' },
    });
    const restoreUnauthorized = mockFetch(() => new Response('nope', { status: 401 }));
    expect(await models('openai')).toEqual({ models: [], error: 'unauthorized' });
    restoreUnauthorized();

    restoreFetch = mockFetch(() => new Response('down', { status: 502 }));
    expect(await models('openai')).toEqual({ models: [], error: 'unreachable' });
  });

  // A vendor whose base URL already carries its version prefix; the catalogue
  // shortens its paths to match, and the joined URL has to come out right.
  test('joins base URL and models path per the catalogue', async () => {
    await put('/api/v1/agents/me/llm-keys', {
      token: user.token,
      body: { provider: 'glm', api_key: 'k' },
    });
    const seen: string[] = [];
    restoreFetch = mockFetch((url) => {
      seen.push(url);
      return Response.json({ data: [] });
    });
    await models('glm');
    expect(seen).toEqual(['https://open.bigmodel.cn/api/paas/v4/models']);
  });

  // A local runtime authenticates with nothing and stores its address in the
  // key slot, so that address is where the listing has to go.
  test('asks a local runtime at its configured address, without a credential', async () => {
    await put('/api/v1/agents/me/llm-keys', {
      token: user.token,
      body: { provider: 'ollama', api_key: 'http://host.docker.internal:11434/' },
    });
    let auth: string | null = 'unset';
    restoreFetch = mockFetch((url, init) => {
      if (!url.startsWith('http://host.docker.internal:11434')) return undefined;
      auth = new Headers(init?.headers).get('authorization');
      return Response.json({ data: [{ id: 'qwen3.8:27b' }] });
    });
    expect(await models('ollama')).toEqual({ models: [{ id: 'qwen3.8:27b' }] });
    expect(auth).toBeNull();
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
