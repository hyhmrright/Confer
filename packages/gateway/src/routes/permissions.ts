import { Hono } from 'hono';
import { AppError, decidePermissionRequestSchema } from '@confer/shared';
import { authMiddleware } from '../middleware/auth.js';
import { getDb } from '../db/connection.js';
import { permissions } from '../db/schema.js';
import { eq, and, isNull, or, ne, desc } from 'drizzle-orm';
import type { AppEnv } from '../types.js';

export const permissionRoutes = new Hono<AppEnv>();

permissionRoutes.use('/*', authMiddleware);

permissionRoutes.get('/pending', async (c) => {
  const user = c.get('user');
  const db = getDb();

  const rows = await db
    .select()
    .from(permissions)
    .where(
      and(
        eq(permissions.user_id, user.sub),
        or(eq(permissions.decision, 'pending'), isNull(permissions.decision)),
      ),
    );

  return c.json({ permissions: rows });
});

permissionRoutes.post('/:id/decide', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const id = c.req.param('id');
  const body = decidePermissionRequestSchema.parse(await c.req.json());

  const [row] = await db
    .select()
    .from(permissions)
    .where(and(eq(permissions.id, id), eq(permissions.user_id, user.sub)))
    .limit(1);

  if (!row) {
    throw new AppError('not_found', 'Permission request not found', 404);
  }

  await db
    .update(permissions)
    .set({
      decision: body.decision,
      decision_scope: body.scope,
      decided_at: new Date(),
      decided_by: user.sub,
    })
    .where(eq(permissions.id, id));

  return c.json({ ok: true });
});

permissionRoutes.get('/history', async (c) => {
  const user = c.get('user');
  const db = getDb();

  const rows = await db
    .select()
    .from(permissions)
    .where(and(eq(permissions.user_id, user.sub), ne(permissions.decision, 'pending')))
    .orderBy(desc(permissions.decided_at))
    .limit(50);

  return c.json({ permissions: rows });
});
