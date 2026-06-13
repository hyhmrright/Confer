import { AppError, decidePermissionRequestSchema, newId } from '@confer/shared';
import { and, desc, eq, isNull, ne, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { peerAgents, peerContacts, permissions } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';
import { resumeHeldA2AQuestion } from './a2a.js';

interface PendingRow {
  action: string;
  scope_json: unknown;
  peer_name: string | null;
  peer_did: string | null;
}

// Build a human-readable description for the permission inbox. Connection
// requests surface who is asking and their opening message; a held A2A question
// surfaces the question text so the owner can decide whether to let the agent
// answer it.
function describePermission(row: PendingRow): string {
  const who = row.peer_name ?? row.peer_did ?? '某个 Agent';
  if (row.action === 'connect') {
    const first = (row.scope_json as { first_message?: string } | null)?.first_message;
    return first
      ? `${who} 请求与你的 Agent 建立连接：“${first}”`
      : `${who} 请求与你的 Agent 建立连接`;
  }
  if (row.action === 'ask') {
    const content = (row.scope_json as { content?: string } | null)?.content;
    return content ? `${who} 向你的 Agent 提问：“${content}”` : `${who} 向你的 Agent 提问`;
  }
  return `${who} 请求执行：${row.action}`;
}

export const permissionRoutes = new Hono<AppEnv>();

permissionRoutes.use('/*', authMiddleware);

permissionRoutes.get('/pending', async (c) => {
  const user = c.get('user');
  const db = getDb();

  const rows = await db
    .select({
      id: permissions.id,
      level: permissions.level,
      action: permissions.action,
      scope_json: permissions.scope_json,
      decision: permissions.decision,
      created_at: permissions.created_at,
      peer_id: permissions.peer_id,
      peer_name: peerAgents.name,
      peer_did: peerAgents.did,
    })
    .from(permissions)
    .leftJoin(peerAgents, eq(permissions.peer_id, peerAgents.id))
    .where(
      and(
        eq(permissions.user_id, user.sub),
        or(eq(permissions.decision, 'pending'), isNull(permissions.decision)),
      ),
    );

  return c.json({
    permissions: rows.map((r) => ({
      id: r.id,
      level: r.level,
      action: r.action,
      scope: r.scope_json,
      decision: r.decision,
      requested_at: r.created_at,
      description: describePermission(r),
    })),
  });
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

  // Approving a connection request establishes the contact, which is what the
  // A2A consent gate checks before letting the peer spend the owner's budget.
  if (row.action === 'connect' && row.peer_id && body.decision.startsWith('allow')) {
    await db
      .insert(peerContacts)
      .values({
        id: newId(),
        user_id: user.sub,
        peer_id: row.peer_id,
        added_via: 'inbound_request',
      })
      .onConflictDoNothing();
  }

  // Approving a held A2A question lets the agent answer it now. Run the agent
  // loop fire-and-forget so this endpoint returns immediately without waiting
  // on the LLM; denials simply leave the request in history with no reply.
  if (
    row.action === 'ask' &&
    (row.scope_json as { kind?: string } | null)?.kind === 'a2a_question' &&
    body.decision.startsWith('allow')
  ) {
    setImmediate(() => {
      resumeHeldA2AQuestion(row).catch((error) =>
        console.error('Failed to resume held A2A question:', error),
      );
    });
  }

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
