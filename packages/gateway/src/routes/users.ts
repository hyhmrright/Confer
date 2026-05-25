import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { getDb } from '../db/connection.js';
import { users, agents } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '../types.js';

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
