import { Hono } from 'hono';
import { z } from 'zod';
import { AppError, encrypt } from '@confer/shared';
import type { EncryptedValue } from '@confer/shared';
import { authMiddleware } from '../middleware/auth.js';
import { getDb } from '../db/connection.js';
import { users, agents } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getEnv } from '../env.js';
import type { AppEnv } from '../types.js';

const PROVIDERS = ['anthropic', 'deepseek', 'openai', 'qwen', 'glm', 'ollama'] as const;
type Provider = (typeof PROVIDERS)[number];

type LlmKeysJson = Partial<Record<Provider, EncryptedValue>>;

const llmKeyBodySchema = z.object({
  provider: z.enum(PROVIDERS),
  api_key: z.string().min(1),
});

const policyBodySchema = z.record(z.unknown());

export const userRoutes = new Hono<AppEnv>();

userRoutes.use('/*', authMiddleware);

userRoutes.get('/me', async (c) => {
  const user = c.get('user');
  const db = getDb();

  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      phone: users.phone,
      display_name: users.display_name,
      avatar_url: users.avatar_url,
      did: users.did,
      preferences_json: users.preferences_json,
      created_at: users.created_at,
    })
    .from(users)
    .where(eq(users.id, user.sub))
    .limit(1);

  return c.json({ user: row });
});

userRoutes.patch('/me', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const body = await c.req.json();

  const allowedFields = ['display_name', 'avatar_url', 'email', 'phone', 'preferences_json'];
  const updates: Record<string, unknown> = { updated_at: new Date() };
  for (const key of allowedFields) {
    if (key in body) {
      updates[key] = body[key];
    }
  }

  await db.update(users).set(updates).where(eq(users.id, user.sub));

  return c.json({ ok: true });
});

export const agentRoutes = new Hono<AppEnv>();

agentRoutes.use('/*', authMiddleware);

agentRoutes.get('/me', async (c) => {
  const user = c.get('user');
  const db = getDb();

  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.user_id, user.sub))
    .limit(1);

  return c.json({ agent });
});

agentRoutes.patch('/me', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const body = await c.req.json();

  const allowedFields = [
    'name',
    'description',
    'avatar_url',
    'primary_language',
    'style',
    'model_config_json',
    'capabilities_json',
    'is_public',
  ];
  const updates: Record<string, unknown> = { updated_at: new Date() };
  for (const key of allowedFields) {
    if (key in body) {
      updates[key] = body[key];
    }
  }

  await db.update(agents).set(updates).where(eq(agents.user_id, user.sub));

  return c.json({ ok: true });
});

agentRoutes.get('/me/llm-keys', async (c) => {
  const user = c.get('user');
  const db = getDb();

  const [row] = await db
    .select({ llm_keys_json: users.llm_keys_json })
    .from(users)
    .where(eq(users.id, user.sub))
    .limit(1);

  const stored = (row?.llm_keys_json ?? {}) as LlmKeysJson;
  const keys = PROVIDERS.map((provider) => ({
    provider,
    configured: provider in stored,
  }));

  return c.json({ keys });
});

agentRoutes.put('/me/llm-keys', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const body = llmKeyBodySchema.parse(await c.req.json());

  const secret = getEnv().ENCRYPTION_KEY;
  const result = await encrypt(body.api_key, secret);
  if (!result.ok) {
    throw new AppError('encryption_failed', result.error, 500);
  }

  const [row] = await db
    .select({ llm_keys_json: users.llm_keys_json })
    .from(users)
    .where(eq(users.id, user.sub))
    .limit(1);

  const stored = ((row?.llm_keys_json ?? {}) as LlmKeysJson);
  const updated: LlmKeysJson = { ...stored, [body.provider]: result.value };

  await db.update(users).set({ llm_keys_json: updated }).where(eq(users.id, user.sub));

  return c.json({ ok: true });
});

agentRoutes.delete('/me/llm-keys/:provider', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const provider = c.req.param('provider') as Provider;

  if (!(PROVIDERS as readonly string[]).includes(provider)) {
    throw new AppError('invalid_provider', `Unknown provider: ${provider}`, 400);
  }

  const [row] = await db
    .select({ llm_keys_json: users.llm_keys_json })
    .from(users)
    .where(eq(users.id, user.sub))
    .limit(1);

  const stored = ((row?.llm_keys_json ?? {}) as LlmKeysJson);
  const { [provider]: _removed, ...rest } = stored;

  await db.update(users).set({ llm_keys_json: rest }).where(eq(users.id, user.sub));

  return c.json({ ok: true });
});

agentRoutes.put('/me/policies', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const body = policyBodySchema.parse(await c.req.json());

  await db.update(agents).set({ policies_json: body, updated_at: new Date() }).where(eq(agents.user_id, user.sub));

  return c.json({ ok: true });
});
