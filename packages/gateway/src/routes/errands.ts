import {
  AppError,
  createErrandSchema,
  decideCardSchema,
  newId,
  pushCardSchema,
} from '@confer/shared';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { errandCards, errandEvents, errands, users } from '../db/schema.js';
import { assertOwnsConversation } from '../lib/tenant.js';
import { isAdminUser } from '../middleware/admin.js';
import { authMiddleware, requireSession } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

// Idea A — outbound delegate-assistant errand decision cards. REST surface (Bearer
// auth, never touches /a2a/v1/*). The decide path NEVER calls
// classifyPermissionLevel and never auto-approves anything: every money/commitment
// decision requires an explicit owner approve (P1/P2). This is the OUTBOUND
// direction and is fully separate from the inbound permissions subsystem.

export const errandRoutes = new Hono<AppEnv>();
errandRoutes.use('/*', authMiddleware);

// Load an errand the caller owns, or 404 (existence is not leaked to non-owners).
async function loadOwnedErrand(userId: string, errandId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(errands)
    .where(and(eq(errands.id, errandId), eq(errands.owner_user_id, userId)))
    .limit(1);
  if (!row) throw new AppError('not_found', 'Errand not found', 404);
  return row;
}

// Load any errand by id, ignoring ownership. ONLY for admin operator branches
// that are allowed to act across owners; never reachable by a non-admin.
async function loadAnyErrand(errandId: string) {
  const db = getDb();
  const [row] = await db.select().from(errands).where(eq(errands.id, errandId)).limit(1);
  if (!row) throw new AppError('not_found', 'Errand not found', 404);
  return row;
}

// Create an errand. Two paths:
//  - owner self-creates from the client → owner = caller;
//  - an admin WoZ operator creates on a target owner's behalf by passing
//    `owner_user_id` → owner = that target.
// The admin check is server-side (DB role), never trusted from the client. A
// non-admin's `owner_user_id` is ignored outright, so the field cannot be used
// to create an errand under someone else's account.
errandRoutes.post('/', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const body = createErrandSchema.parse(await c.req.json());

  let ownerId = user.sub;
  if (body.owner_user_id && body.owner_user_id !== user.sub && (await isAdminUser(user.sub))) {
    // Admin operator delegating: the target owner must exist (avoids a bare FK
    // 500 and does not leak existence to non-admins, who never reach here).
    const [target] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, body.owner_user_id))
      .limit(1);
    if (!target) throw new AppError('not_found', 'Target owner not found', 404);
    ownerId = target.id;
  }

  if (body.conversation_id) await assertOwnsConversation(ownerId, body.conversation_id);
  const id = newId();
  await db.insert(errands).values({
    id,
    owner_user_id: ownerId,
    title: body.title,
    kind: body.kind,
    conversation_id: body.conversation_id,
    // Audit trail: the actual caller (owner self-create or admin operator).
    created_by: user.sub,
  });

  await db
    .insert(errandEvents)
    .values({ id: newId(), errand_id: id, actor_id: user.sub, status: 'in_progress', note: '' });
  return c.json({ id, status: 'in_progress' }, 201);
});

// List the owner's errands (newest first) for the client inbox poll.
errandRoutes.get('/', async (c) => {
  const user = c.get('user');
  const db = getDb();

  const rows = await db
    .select()
    .from(errands)
    .where(eq(errands.owner_user_id, user.sub))
    .orderBy(desc(errands.created_at))
    .limit(100);

  return c.json({ errands: rows });
});

// Pending decision cards across all the owner's errands — what the client polls
// to render the errand inbox. Pending = not yet decided and not yet expired.
errandRoutes.get('/cards/pending', async (c) => {
  const user = c.get('user');
  const db = getDb();

  const rows = await db
    .select({
      id: errandCards.id,
      errand_id: errandCards.errand_id,
      errand_title: errands.title,
      kind: errandCards.kind,
      summary: errandCards.summary,
      currency: errandCards.currency,
      base_price_cents: errandCards.base_price_cents,
      price_delta_cents: errandCards.price_delta_cents,
      strictly_necessary: errandCards.strictly_necessary,
      expires_at: errandCards.expires_at,
      created_at: errandCards.created_at,
    })
    .from(errandCards)
    .innerJoin(errands, eq(errandCards.errand_id, errands.id))
    .where(
      and(
        eq(errands.owner_user_id, user.sub),
        eq(errandCards.decision, 'pending'),
        notInArray(errands.status, ['human_control', 'completed', 'cancelled']),
      ),
    )
    .orderBy(desc(errandCards.created_at));

  // Hide already-expired cards from the actionable inbox (they 409 on decide).
  const now = Date.now();
  return c.json({ cards: rows.filter((r) => r.expires_at.getTime() > now) });
});

// Errand detail with its cards.
errandRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const errand = await loadOwnedErrand(user.sub, c.req.param('id'));

  const cards = await db
    .select()
    .from(errandCards)
    .where(eq(errandCards.errand_id, errand.id))
    .orderBy(desc(errandCards.created_at));

  const events = await db
    .select()
    .from(errandEvents)
    .where(eq(errandEvents.errand_id, errand.id))
    .orderBy(desc(errandEvents.id))
    .limit(100);
  return c.json({ errand, cards, events });
});

// Push a decision card onto an errand. An admin WoZ operator may push onto ANY
// errand (operating on behalf of its owner); everyone else is owner-only, and a
// non-owner sees a 404 (existence is not leaked). The card is always pending and
// only the errand's owner can ever decide it — the operator never decides.
errandRoutes.post('/:id/cards', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const errandId = c.req.param('id');
  const errand = (await isAdminUser(user.sub))
    ? await loadAnyErrand(errandId)
    : await loadOwnedErrand(user.sub, errandId);
  const body = pushCardSchema.parse(await c.req.json());

  const id = newId();
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(errands)
      .where(eq(errands.id, errand.id))
      .for('update');
    if (!current || ['completed', 'cancelled', 'human_control'].includes(current.status))
      throw new AppError('errand_paused', 'Errand is not accepting decision cards', 409);
    await tx.insert(errandCards).values({
      id,
      errand_id: errand.id,
      kind: body.kind,
      summary: body.summary,
      currency: body.currency,
      base_price_cents: body.base_price_cents,
      price_delta_cents: body.price_delta_cents,
      strictly_necessary: body.strictly_necessary,
      expires_at: body.expires_at,
      // Audit trail: the actual caller (owner pushing, or admin operator pushing).
      pushed_by: user.sub,
    });

    await tx
      .update(errands)
      .set({ status: 'waiting_input', updated_at: new Date() })
      .where(eq(errands.id, errand.id));
    await tx.insert(errandEvents).values({
      id: newId(),
      errand_id: errand.id,
      actor_id: user.sub,
      status: 'waiting_input',
      note: body.summary,
    });
  });
  return c.json({ id, decision: 'pending' }, 201);
});

// Owner decides on a card: approve / change_price / reject. Owner-only (a card
// belonging to another owner's errand is 403). An expired card is 409. No
// permission-level classification and no autonomous release — the decision is the
// authorization.
// The owner's own approval; never given by a script holding their API token.
errandRoutes.post('/cards/:cardId/decide', requireSession, async (c) => {
  const user = c.get('user');
  const cardId = c.req.param('cardId');
  const body = decideCardSchema.parse(await c.req.json());
  const db = getDb();
  const [card] = await db.select().from(errandCards).where(eq(errandCards.id, cardId));
  if (!card) throw new AppError('not_found', 'Decision card not found', 404);
  await db.transaction(async (tx) => {
    // Same lock order as progress/push: a takeover cannot race an approval.
    const [parent] = await tx
      .select()
      .from(errands)
      .where(eq(errands.id, card.errand_id))
      .for('update');
    if (!parent || parent.owner_user_id !== user.sub)
      throw new AppError('forbidden', 'Not the errand owner', 403);
    const [current] = await tx
      .select()
      .from(errandCards)
      .where(eq(errandCards.id, cardId))
      .for('update');
    if (current?.decision !== 'pending')
      throw new AppError('already_decided', 'Card already decided', 409);
    if (current.expires_at.getTime() <= Date.now())
      throw new AppError('card_expired', 'Decision card has expired', 409);
    if (['completed', 'cancelled', 'human_control'].includes(parent.status))
      throw new AppError('errand_paused', 'Errand is not accepting decisions', 409);
    await tx
      .update(errandCards)
      .set({
        decision: body.decision,
        new_price_cents: body.decision === 'change_price' ? body.new_price_cents : null,
        decided_at: new Date(),
        decided_by: user.sub,
      })
      .where(eq(errandCards.id, cardId));
    const pending = await tx
      .select()
      .from(errandCards)
      .where(and(eq(errandCards.errand_id, parent.id), eq(errandCards.decision, 'pending')));
    const status = pending.some((c) => c.expires_at.getTime() > Date.now())
      ? 'waiting_input'
      : 'in_progress';
    await tx
      .update(errands)
      .set({ status, updated_at: new Date() })
      .where(eq(errands.id, parent.id));
    await tx.insert(errandEvents).values({
      id: newId(),
      errand_id: parent.id,
      actor_id: user.sub,
      status,
      note: current.summary,
    });
  });
  return c.json({ ok: true, decision: body.decision });
});

// Progress is explicit, durable operator/owner input; no simulated execution.
const progressInput = z.object({
  status: z.enum([
    'in_progress',
    'waiting_peer',
    'waiting_input',
    'human_control',
    'completed',
    'cancelled',
  ]),
  note: z.string().trim().max(4000).default(''),
});
errandRoutes.post('/:id/progress', async (c) => {
  const body = progressInput.parse(await c.req.json());
  const user = c.get('user');
  const admin = await isAdminUser(user.sub);
  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(errands)
      .where(eq(errands.id, c.req.param('id')))
      .for('update');
    if (!row || (row.owner_user_id !== user.sub && !admin))
      throw new AppError('not_found', 'Errand not found', 404);
    const owner = row.owner_user_id === user.sub;
    if (['completed', 'cancelled'].includes(row.status))
      throw new AppError('errand_finished', 'Errand has finished', 409);
    if (
      (body.status === 'human_control' ||
        body.status === 'cancelled' ||
        row.status === 'human_control') &&
      (!owner || user.via !== 'session')
    ) {
      throw new AppError(
        'session_required',
        'Only the signed-in owner may take over, cancel or resume',
        403,
      );
    }
    await tx
      .update(errands)
      .set({
        status: body.status,
        updated_at: new Date(),
        completed_at: ['completed', 'cancelled'].includes(body.status) ? new Date() : null,
      })
      .where(eq(errands.id, row.id));
    await tx
      .insert(errandEvents)
      .values({ id: newId(), errand_id: row.id, actor_id: user.sub, ...body });
  });
  return c.json({ ok: true });
});
