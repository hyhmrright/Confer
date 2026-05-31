import { AppError, consultRequestSchema, newId } from '@confer/shared';
import { and, asc, eq, gt } from 'drizzle-orm';
import { Hono } from 'hono';
import { deliverConsult } from '../a2a/consult.js';
import { getDb } from '../db/connection.js';
import {
  conversationParticipants,
  conversations,
  messages,
  peerContacts,
} from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

export const consultRoutes = new Hono<AppEnv>();
consultRoutes.use('/*', authMiddleware);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Find an existing consult conversation with this peer, or create one with the
// user + peer as participants. Returns the conversation id.
async function getOrCreateConsultConversation(userId: string, peerId: string): Promise<string> {
  const db = getDb();
  const [existing] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(
      conversationParticipants,
      eq(conversationParticipants.conversation_id, conversations.id),
    )
    .where(
      and(
        eq(conversations.type, 'consult'),
        eq(conversations.created_by, userId),
        eq(conversationParticipants.peer_id, peerId),
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  const convId = newId();
  await db.insert(conversations).values({ id: convId, type: 'consult', created_by: userId });
  await db.insert(conversationParticipants).values([
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
  return convId;
}

// Verify the user owns the conversation before exposing its messages.
async function assertOwnsConversation(userId: string, convId: string): Promise<void> {
  const db = getDb();
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, convId), eq(conversations.created_by, userId)))
    .limit(1);
  if (!conv) throw new AppError('not_found', 'Conversation not found', 404);
}

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

  const result = await deliverConsult({ userId: user.sub, peerId, conversationId: convId, content });

  await db
    .update(messages)
    .set({
      delivery_status: result.ok ? 'sent' : 'failed',
      delivered_at: result.ok ? new Date() : null,
    })
    .where(eq(messages.id, msgId));

  await db.update(conversations).set({ updated_at: new Date() }).where(eq(conversations.id, convId));

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

  const afterId = c.req.query('after');
  const waitMs = Math.min(Number(c.req.query('wait') ?? '25'), 55) * 1000;

  // Cursor: only consider peer replies created strictly after the `after`
  // message (the user's question). Falls back to epoch when absent.
  let afterTs = new Date(0);
  if (afterId) {
    const [m] = await db.select().from(messages).where(eq(messages.id, afterId)).limit(1);
    if (m) afterTs = m.created_at;
  }

  const deadline = Date.now() + waitMs;
  for (;;) {
    const [reply] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversation_id, convId),
          eq(messages.sender_type, 'peer_agent'),
          gt(messages.created_at, afterTs),
        ),
      )
      .orderBy(asc(messages.created_at))
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
