import {
  AppError,
  decidePermissionRequestSchema,
  newId,
  policyOverridesSchema,
} from '@confer/shared';
import { and, desc, eq, isNull, ne, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { resumeHeldA2AQuestion } from '../a2a/answer.js';
import { getDb } from '../db/connection.js';
import { peerAgents, peerContacts, permissions } from '../db/schema.js';
import { runDetached } from '../lib/background.js';
import { toPermissionRequestEvent } from '../lib/permission-notify.js';
import { authMiddleware, requireSession } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

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
    )
    // Bound the inbox and show newest first, mirroring `/history`.
    .orderBy(desc(permissions.created_at))
    .limit(50);

  // Same builder as the live `permission.request` push, so a row that arrives
  // by poll and one that arrives by socket are byte-identical to the client.
  return c.json({ permissions: rows.map(toPermissionRequestEvent) });
});

// A decision is the owner's consent; a script holding their token may not give it.
permissionRoutes.post('/:id/decide', requireSession, async (c) => {
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

  // Claim the decision atomically: only the first decider moves it out of
  // pending, so two concurrent approvals can't both establish the contact or
  // fire the held-question resume (which would double-answer the peer).
  const claimed = await db
    .update(permissions)
    .set({
      decision: body.decision,
      decision_scope: body.scope,
      decided_at: new Date(),
      decided_by: user.sub,
    })
    .where(
      and(
        eq(permissions.id, id),
        or(eq(permissions.decision, 'pending'), isNull(permissions.decision)),
      ),
    )
    .returning({ id: permissions.id });

  // Already decided by a concurrent request — don't run the side effects twice.
  if (claimed.length === 0) return c.json({ ok: true });

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

  // "Always" on a held question is a standing grant for this peer, so the next
  // question is not held again. It becomes a rule on the contact's own policy —
  // where the owner can see and revoke it in the contact panel — rather than a
  // permission row every later request would have to go looking for.
  if (row.action === 'ask' && row.peer_id && body.decision.endsWith('_always')) {
    await setStandingAskRule(
      user.sub,
      row.peer_id,
      body.decision === 'allow_always' ? 'allow' : 'deny',
    );
  }

  // Approving a held A2A question lets the agent answer it now. Run the agent
  // loop fire-and-forget so this endpoint returns immediately without waiting
  // on the LLM; denials simply leave the request in history with no reply.
  if (
    row.action === 'ask' &&
    (row.scope_json as { kind?: string } | null)?.kind === 'a2a_question' &&
    body.decision.startsWith('allow')
  ) {
    // Registered now, started on the next tick: the response goes out first,
    // and a test can still join work that has not begun.
    runDetached(
      new Promise<void>((tick) => setImmediate(tick)).then(() => resumeHeldA2AQuestion(row)),
      (error) => console.error('Failed to resume held A2A question:', error),
    );
  }

  return c.json({ ok: true });
});

// Put an `ask` rule at the front of the contact's policy override, replacing any
// earlier one so repeated "always" decisions don't stack. A peer that is no
// longer a contact has nothing to attach a rule to; the consent gate already
// keeps it out.
async function setStandingAskRule(
  userId: string,
  peerId: string,
  decision: 'allow' | 'deny',
): Promise<void> {
  const db = getDb();
  const [contact] = await db
    .select({ id: peerContacts.id, overrides: peerContacts.policy_overrides_json })
    .from(peerContacts)
    .where(and(eq(peerContacts.user_id, userId), eq(peerContacts.peer_id, peerId)))
    .limit(1);
  if (!contact) return;

  const parsed = policyOverridesSchema.safeParse(contact.overrides ?? {});
  const current = parsed.success ? parsed.data : {};
  const rules = (current.rules ?? []).filter((r) => r.action !== 'ask');

  await db
    .update(peerContacts)
    .set({ policy_overrides_json: { ...current, rules: [{ action: 'ask', decision }, ...rules] } })
    .where(eq(peerContacts.id, contact.id));
}

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
