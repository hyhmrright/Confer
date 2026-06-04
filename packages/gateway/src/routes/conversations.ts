import { AppError, newId, sendMessageRequestSchema } from '@confer/shared';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { conversationParticipants, conversations, messages } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

export const conversationRoutes = new Hono<AppEnv>();

conversationRoutes.use('/*', authMiddleware);

conversationRoutes.get('/', async (c) => {
  const user = c.get('user');
  const db = getDb();

  const participantRows = await db
    .select({ conversation_id: conversationParticipants.conversation_id })
    .from(conversationParticipants)
    .where(eq(conversationParticipants.user_id, user.sub));

  const convIds = participantRows.map((r) => r.conversation_id);
  if (convIds.length === 0) {
    return c.json({ conversations: [] });
  }

  const convs = await db
    .select()
    .from(conversations)
    .where(
      and(
        inArray(conversations.id, convIds),
        // Admin-hidden conversations are invisible to regular users.
        eq(conversations.moderation_status, 'visible'),
      ),
    )
    .orderBy(desc(conversations.updated_at))
    .limit(50);

  return c.json({ conversations: convs });
});

conversationRoutes.post('/', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const body = await c.req.json();

  const convId = newId();
  const [conv] = await db
    .insert(conversations)
    .values({
      id: convId,
      type: body.type ?? 'direct_user_agent',
      name: body.name,
      created_by: user.sub,
    })
    .returning();

  await db.insert(conversationParticipants).values({
    id: newId(),
    conversation_id: convId,
    participant_type: 'user',
    user_id: user.sub,
    role: 'admin',
  });

  return c.json({ conversation: conv }, 201);
});

conversationRoutes.get('/:id', async (c) => {
  const db = getDb();
  const [conv] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, c.req.param('id')),
        // A hidden conversation reads as not-found for regular users.
        eq(conversations.moderation_status, 'visible'),
      ),
    )
    .limit(1);

  if (!conv) {
    throw new AppError('not_found', 'Conversation not found', 404);
  }

  return c.json({ conversation: conv });
});

conversationRoutes.get('/:id/messages', async (c) => {
  const db = getDb();
  const convId = c.req.param('id');
  const before = c.req.query('before');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 100);

  // Admin-hidden messages are filtered from regular reads.
  const visible = eq(messages.moderation_status, 'visible');
  const query = db
    .select()
    .from(messages)
    .where(
      before
        ? and(eq(messages.conversation_id, convId), lt(messages.id, before), visible)
        : and(eq(messages.conversation_id, convId), visible),
    )
    .orderBy(desc(messages.created_at))
    .limit(limit);

  const msgs = await query;

  return c.json({ messages: msgs.reverse() });
});

conversationRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const convId = c.req.param('id');

  const [participant] = await db
    .select()
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversation_id, convId),
        eq(conversationParticipants.user_id, user.sub),
      ),
    )
    .limit(1);

  if (!participant) {
    throw new AppError('forbidden', 'Not a participant', 403);
  }

  await db
    .delete(conversationParticipants)
    .where(eq(conversationParticipants.conversation_id, convId));
  await db.delete(messages).where(eq(messages.conversation_id, convId));
  await db.delete(conversations).where(eq(conversations.id, convId));

  return c.json({ ok: true });
});

conversationRoutes.post('/:id/messages', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const convId = c.req.param('id');
  const body = sendMessageRequestSchema.parse(await c.req.json());

  const msgId = newId();
  const [msg] = await db
    .insert(messages)
    .values({
      id: msgId,
      conversation_id: convId,
      sender_type: 'user',
      sender_id: user.sub,
      content_type: body.content_type,
      content: body.content,
      in_reply_to: body.in_reply_to,
      via: body.via,
    })
    .returning();

  if (!msg) {
    throw new AppError('message_creation_failed', 'Failed to create message', 500);
  }

  await db
    .update(conversations)
    .set({ updated_at: new Date() })
    .where(eq(conversations.id, convId));

  return c.json(
    {
      id: msg.id,
      delivery_status: 'queued',
      stream_url: `/api/v1/stream/${convId}/${msgId}`,
    },
    201,
  );
});
