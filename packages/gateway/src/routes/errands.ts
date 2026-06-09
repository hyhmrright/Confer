import {
  AppError,
  createErrandSchema,
  decideCardSchema,
  newId,
  pushCardSchema,
} from '@confer/shared';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { errandCards, errands, users } from '../db/schema.js';
import { isAdminUser } from '../middleware/admin.js';
import { authMiddleware } from '../middleware/auth.js';
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
    .where(and(eq(errands.owner_user_id, user.sub), eq(errandCards.decision, 'pending')))
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

  return c.json({ errand, cards });
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
  await db.insert(errandCards).values({
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

  return c.json({ id, decision: 'pending' }, 201);
});

// Owner decides on a card: approve / change_price / reject. Owner-only (a card
// belonging to another owner's errand is 403). An expired card is 409. No
// permission-level classification and no autonomous release — the decision is the
// authorization.
errandRoutes.post('/cards/:cardId/decide', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const cardId = c.req.param('cardId');
  const body = decideCardSchema.parse(await c.req.json());

  const [row] = await db
    .select({
      id: errandCards.id,
      decision: errandCards.decision,
      expires_at: errandCards.expires_at,
      owner_user_id: errands.owner_user_id,
    })
    .from(errandCards)
    .innerJoin(errands, eq(errandCards.errand_id, errands.id))
    .where(eq(errandCards.id, cardId))
    .limit(1);

  if (!row) throw new AppError('not_found', 'Decision card not found', 404);
  // Only the errand's owner may decide its cards.
  if (row.owner_user_id !== user.sub) {
    throw new AppError('forbidden', 'Not the errand owner', 403);
  }
  if (row.decision !== 'pending') {
    throw new AppError('already_decided', 'Card already decided', 409);
  }
  if (row.expires_at.getTime() <= Date.now()) {
    throw new AppError('card_expired', 'Decision card has expired', 409);
  }

  await db
    .update(errandCards)
    .set({
      decision: body.decision,
      new_price_cents: body.decision === 'change_price' ? body.new_price_cents : null,
      decided_at: new Date(),
      decided_by: user.sub,
    })
    .where(eq(errandCards.id, cardId));

  return c.json({ ok: true, decision: body.decision });
});
