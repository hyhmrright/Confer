import type { EncryptedValue, LlmProviderSpec } from '@confer/shared';
import {
  AppError,
  decrypt,
  encrypt,
  LLM_PROVIDER_IDS,
  llmProvider,
  providerBaseUrl,
  updateAgentRequestSchema,
  updateProfileRequestSchema,
} from '@confer/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { agents, users } from '../db/schema.js';
import { getEnv } from '../env.js';
import { getUserLlmKeys } from '../lib/llm-keys.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

// Key slots the owner can fill: every catalogued LLM provider, plus the tool
// services that also authenticate with a stored key. The LLM half comes from
// the shared catalogue so a new vendor is one edit, not two.
const TOOL_PROVIDERS = ['tavily'] as const;
const PROVIDERS = [...LLM_PROVIDER_IDS, ...TOOL_PROVIDERS] as readonly string[];
type Provider = string;

type LlmKeysJson = Record<string, EncryptedValue>;

const llmKeyBodySchema = z
  .object({
    provider: z.string().refine((p) => PROVIDERS.includes(p), 'Unknown provider'),
    api_key: z.string().min(1),
  })
  // For a local runtime this field is an address, not a credential, and the
  // gateway goes on to dial it — both to chat and to list models. Check it is a
  // plain http(s) URL at the point it is stored: the owner gets told now rather
  // than through a puzzling failure at chat time, and the fetch can never be
  // handed a `file:` or other scheme.
  .refine(
    ({ provider, api_key }) => !llmProvider(provider)?.keyIsBaseUrl || isHttpUrl(api_key),
    'Local runtimes take a base URL, e.g. http://host.docker.internal:11434',
  );

function isHttpUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const policyBodySchema = z.record(z.string(), z.unknown());

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
      role: users.role,
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

  // Zod both allow-lists the fields and checks the values. The hand-rolled
  // version did only the former: unknown keys were dropped, but anything at all
  // could ride in on a known one. Zod strips the unknown keys too, so `role` and
  // `status` are no more reachable than before.
  const updates = updateProfileRequestSchema.parse(await c.req.json());

  await db
    .update(users)
    .set({ ...updates, updated_at: new Date() })
    .where(eq(users.id, user.sub));

  return c.json({ ok: true });
});

export const agentRoutes = new Hono<AppEnv>();

agentRoutes.use('/*', authMiddleware);

agentRoutes.get('/me', async (c) => {
  const user = c.get('user');
  const db = getDb();

  const [agent] = await db.select().from(agents).where(eq(agents.user_id, user.sub)).limit(1);

  return c.json({ agent });
});

agentRoutes.patch('/me', async (c) => {
  const user = c.get('user');
  const db = getDb();

  // `status` is the field this most needs to keep out: it is what moderation
  // sets to suspend an agent, and it was never in the allow-list — but neither
  // was anything checking the values that WERE allowed, and `is_public` decides
  // whether the agent is discoverable at all.
  const updates = updateAgentRequestSchema.parse(await c.req.json());

  await db
    .update(agents)
    .set({ ...updates, updated_at: new Date() })
    .where(eq(agents.user_id, user.sub));

  return c.json({ ok: true });
});

// Same read as the shared helper, narrowed to this file's provider-keyed view.
async function loadLlmKeys(userId: string): Promise<LlmKeysJson> {
  return (await getUserLlmKeys(userId)) as LlmKeysJson;
}

agentRoutes.get('/me/llm-keys', async (c) => {
  const user = c.get('user');

  const stored = await loadLlmKeys(user.sub);
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

  const stored = await loadLlmKeys(user.sub);
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

  const stored = await loadLlmKeys(user.sub);
  const { [provider]: _removed, ...rest } = stored;

  await db.update(users).set({ llm_keys_json: rest }).where(eq(users.id, user.sub));

  return c.json({ ok: true });
});

/*
  Ask the vendor which models this account can use.

  Every outcome used to collapse to `{ models: [] }` — no key, an undecryptable
  key, a rejected key, a vendor that was down — and the settings UI read all
  four as "this provider has no models" and quietly fell back to a hand-written
  list. The reason now ships with the (still empty) list so the UI can say
  which of them happened.
*/
type ModelsFailure = 'no_key' | 'unsupported' | 'unauthorized' | 'unreachable';

agentRoutes.get('/me/llm-keys/:provider/models', async (c) => {
  const user = c.get('user');
  const spec = llmProvider(c.req.param('provider'));

  if (!spec) {
    throw new AppError('invalid_provider', `Unknown provider: ${c.req.param('provider')}`, 400);
  }
  if (!spec.modelsPath) {
    return c.json({ models: [], error: 'unsupported' satisfies ModelsFailure });
  }

  const stored = await loadLlmKeys(user.sub);
  const encryptedKey = stored[spec.id];

  // A local runtime authenticates with nothing — it stores an address here, or
  // falls back to the catalogue's. Everyone else needs a key that decrypts.
  let key = '';
  if (encryptedKey) {
    const decrypted = await decrypt(encryptedKey, getEnv().ENCRYPTION_KEY);
    if (!decrypted.ok) {
      return c.json({ models: [], error: 'no_key' satisfies ModelsFailure });
    }
    key = decrypted.value;
  } else if (!spec.keyIsBaseUrl) {
    return c.json({ models: [], error: 'no_key' satisfies ModelsFailure });
  }

  return c.json(await fetchProviderModels(spec, key));
});

function modelsAuthHeaders(spec: LlmProviderSpec, key: string): Record<string, string> {
  if (spec.keyIsBaseUrl) return {};
  if (spec.kind === 'anthropic') return { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  return { Authorization: `Bearer ${key}` };
}

async function fetchProviderModels(
  spec: LlmProviderSpec,
  key: string,
): Promise<{ models: { id: string }[]; error?: ModelsFailure }> {
  const url = `${providerBaseUrl(spec, key)}${spec.modelsPath}`;
  const headers = modelsAuthHeaders(spec, key);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const resp = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);

    if (resp.status === 401 || resp.status === 403) {
      return { models: [], error: 'unauthorized' };
    }
    if (!resp.ok) return { models: [], error: 'unreachable' };

    // Take the ids and nothing else. The rest of a vendor's model object is
    // unused, and for a local runtime the address came from the owner — this
    // endpoint should not become a way to read back whatever a chosen host
    // puts in a `data` array.
    const body = (await resp.json()) as { data?: { id?: unknown }[] };
    const models = (body.data ?? [])
      .filter((m) => typeof m.id === 'string')
      .map((m) => ({ id: m.id as string }));
    return { models };
  } catch {
    return { models: [], error: 'unreachable' };
  }
}

agentRoutes.put('/me/policies', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const body = policyBodySchema.parse(await c.req.json());

  await db
    .update(agents)
    .set({ policies_json: body, updated_at: new Date() })
    .where(eq(agents.user_id, user.sub));

  return c.json({ ok: true });
});
