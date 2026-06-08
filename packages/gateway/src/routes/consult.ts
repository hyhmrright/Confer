import { createHash } from 'node:crypto';
import { AppError, consultRequestSchema, newId } from '@confer/shared';
import { and, asc, eq, gt, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { deliverConsult } from '../a2a/consult.js';
import { getDb } from '../db/connection.js';
import { conversationParticipants, conversations, messages, peerContacts } from '../db/schema.js';
import { assertOwnsConversation } from '../lib/conversation-auth.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

export const consultRoutes = new Hono<AppEnv>();
consultRoutes.use('/*', authMiddleware);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// Deterministic 26-char (ULID-shaped) conversation id for a (user, peer) pair.
// Making the id derivable means concurrent first-consults collide on the
// primary key instead of racing to create two duplicate threads.
function consultConversationId(userId: string, peerId: string): string {
  const hash = createHash('sha256').update(`consult:${userId}:${peerId}`).digest();
  let n = 0n;
  for (let i = 0; i < 16; i++) n = (n << 8n) | BigInt(hash[i] ?? 0);
  let out = '';
  for (let i = 0; i < 26; i++) {
    out = CROCKFORD[Number(n & 31n)] + out;
    n >>= 5n;
  }
  return out;
}

// Return the consult conversation for this (user, peer), creating it on first
// use. The conversation id is deterministic and the insert is conflict-safe, so
// concurrent callers converge on one thread (the loser's insert is a no-op).
async function getOrCreateConsultConversation(userId: string, peerId: string): Promise<string> {
  const db = getDb();
  const convId = consultConversationId(userId, peerId);

  // Atomic so a conversation row can never persist without its participants:
  // the creator inserts both or neither. Concurrent callers conflict on the
  // deterministic primary key and skip participant seeding (no duplicates).
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(conversations)
      .values({ id: convId, type: 'consult', created_by: userId })
      .onConflictDoNothing()
      .returning({ id: conversations.id });
    if (inserted.length === 0) return;

    await tx.insert(conversationParticipants).values([
      {
        id: newId(),
        conversation_id: convId,
        participant_type: 'user',
        user_id: userId,
        role: 'owner',
      },
      {
        id: newId(),
        conversation_id: convId,
        participant_type: 'peer_agent',
        peer_id: peerId,
        role: 'member',
      },
    ]);
  });
  return convId;
}

// Verify the user owns the conversation before exposing its messages.
consultRoutes.post('/:peerId', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const peerId = c.req.param('peerId');
  const parsed = consultRequestSchema.parse(await c.req.json());

  // Only peers the user has connected to may be consulted.
  const [contact] = await db
    .select()
    .from(peerContacts)
    .where(and(eq(peerContacts.user_id, user.sub), eq(peerContacts.peer_id, peerId)))
    .limit(1);
  if (!contact) throw new AppError('not_a_contact', 'Peer is not a contact', 403);

  const convId = await getOrCreateConsultConversation(user.sub, peerId);

  const content = parsed.code_context
    ? `${parsed.question}\n\n---\n\`\`\`\n${parsed.code_context}\n\`\`\``
    : parsed.question;

  const msgId = newId();
  await db.insert(messages).values({
    id: msgId,
    conversation_id: convId,
    sender_type: 'user',
    sender_id: user.sub,
    content_type: 'text',
    content,
    language: parsed.language,
    via: 'a2a',
  });

  const result = await deliverConsult({
    userId: user.sub,
    peerId,
    conversationId: convId,
    content,
  });

  await db
    .update(messages)
    .set({
      delivery_status: result.ok ? 'sent' : 'failed',
      delivered_at: result.ok ? new Date() : null,
    })
    .where(eq(messages.id, msgId));

  await db
    .update(conversations)
    .set({ updated_at: new Date() })
    .where(eq(conversations.id, convId));

  // A failed question stays in the thread on purpose (auditable); clients can
  // tell it apart by its delivery_status, which the history endpoint returns.
  if (!result.ok) {
    return c.json(
      { conversation_id: convId, message_id: msgId, status: 'failed', error: result.error },
      502,
    );
  }
  return c.json({ conversation_id: convId, message_id: msgId, status: 'sent' }, 201);
});

// More specific route must be registered before `/:conversationId`.
consultRoutes.get('/:conversationId/reply', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const convId = c.req.param('conversationId');
  await assertOwnsConversation(user.sub, convId);

  // Clamp wait defensively: a non-numeric query param must not produce a NaN
  // deadline (which would make the poll loop run forever). An explicitly
  // garbage value is treated as 0 (return immediately), not the absent-default.
  const rawWait = Number(c.req.query('wait') ?? '25');
  const waitMs = (Number.isFinite(rawWait) ? Math.min(Math.max(rawWait, 0), 55) : 0) * 1000;

  // Cursor over (created_at, id) so same-timestamp ties can't drop or duplicate
  // a reply. `after` is the user's question id; an unknown id is a client bug,
  // not "return the oldest reply" — reject it rather than misattribute.
  const afterId = c.req.query('after');
  let afterTs = new Date(0);
  let afterCursorId = '';
  if (afterId) {
    // Scope the cursor lookup to this conversation: a message id from another
    // thread must not silently set the cursor.
    const [m] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.id, afterId), eq(messages.conversation_id, convId)))
      .limit(1);
    if (!m) throw new AppError('unknown_cursor', 'after message not found in this thread', 400);
    afterTs = m.created_at;
    afterCursorId = m.id;
  }

  // Correlate only with replies from THIS thread's peer participant, so a
  // message from any other sender can never be returned as the answer.
  const [peerParticipant] = await db
    .select({ peer_id: conversationParticipants.peer_id })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversation_id, convId),
        eq(conversationParticipants.participant_type, 'peer_agent'),
      ),
    )
    .limit(1);
  const peerId = peerParticipant?.peer_id ?? null;
  // No peer participant => nothing can answer this thread; don't poll.
  if (!peerId) return c.json({ status: 'pending' });

  const cursor = afterCursorId
    ? or(
        gt(messages.created_at, afterTs),
        and(eq(messages.created_at, afterTs), gt(messages.id, afterCursorId)),
      )
    : gt(messages.created_at, afterTs);

  const deadline = Date.now() + waitMs;
  for (;;) {
    const [reply] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversation_id, convId),
          eq(messages.sender_type, 'peer_agent'),
          eq(messages.sender_id, peerId),
          cursor,
        ),
      )
      .orderBy(asc(messages.created_at), asc(messages.id))
      .limit(1);

    if (reply) return c.json({ status: 'answered', message: reply });
    if (Date.now() >= deadline) return c.json({ status: 'pending' });
    await sleep(500);
  }
});

consultRoutes.get('/:conversationId', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const convId = c.req.param('conversationId');
  await assertOwnsConversation(user.sub, convId);

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversation_id, convId))
    .orderBy(asc(messages.created_at))
    .limit(200);

  return c.json({ conversation_id: convId, messages: rows });
});
