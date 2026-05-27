import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { getDb } from '../db/connection.js';
import { agentMemories } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { AppError, newId } from '@confer/shared';
import type { AppEnv } from '../types.js';

export const memoriesRoutes = new Hono<AppEnv>();

memoriesRoutes.use('/*', authMiddleware);

const createSchema = z.object({
  title: z.string().min(1).max(255),
  content: z.string().min(1),
  tags: z.array(z.string()).optional(),
  pinned: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

memoriesRoutes.get('/', async (c) => {
  const user = c.get('user');
  const db = getDb();

  const rows = await db
    .select()
    .from(agentMemories)
    .where(eq(agentMemories.user_id, user.sub))
    .orderBy(desc(agentMemories.pinned), desc(agentMemories.updated_at))
    .limit(100);

  return c.json({ memories: rows });
});

memoriesRoutes.post('/', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const body = createSchema.parse(await c.req.json());

  const [row] = await db
    .insert(agentMemories)
    .values({
      id: newId(),
      user_id: user.sub,
      title: body.title,
      content: body.content,
      tags: body.tags ?? [],
      pinned: body.pinned ?? false,
    })
    .returning();

  return c.json({ memory: row }, 201);
});

memoriesRoutes.patch('/:id', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const id = c.req.param('id');
  const body = updateSchema.parse(await c.req.json());

  const [row] = await db
    .update(agentMemories)
    .set({ ...body, updated_at: new Date() })
    .where(and(eq(agentMemories.id, id), eq(agentMemories.user_id, user.sub)))
    .returning();

  if (!row) throw new AppError('not_found', 'Memory not found', 404);
  return c.json({ memory: row });
});

memoriesRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const id = c.req.param('id');

  const deleted = await db
    .delete(agentMemories)
    .where(and(eq(agentMemories.id, id), eq(agentMemories.user_id, user.sub)))
    .returning({ id: agentMemories.id });

  if (!deleted.length) throw new AppError('not_found', 'Memory not found', 404);
  return c.json({ ok: true });
});
