import { Hono } from 'hono';
import { sendMessageRequestSchema, AppError, newId } from '@confer/shared';
import { authMiddleware } from '../middleware/auth.js';
import { getDb } from '../db/connection.js';
import { conversations, conversationParticipants, messages } from '../db/schema.js';
import { eq, desc, and, lt, inArray } from 'drizzle-orm';
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
    .where(inArray(conversations.id, convIds))
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
    .where(eq(conversations.id, c.req.param('id')))
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

  let query = db
    .select()
    .from(messages)
    .where(
      before
        ? and(eq(messages.conversation_id, convId), lt(messages.id, before))
        : eq(messages.conversation_id, convId),
    )
    .orderBy(desc(messages.created_at))
    .limit(limit);

  const msgs = await query;

  return c.json({ messages: msgs.reverse() });
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

  await db
    .update(conversations)
    .set({ updated_at: new Date() })
    .where(eq(conversations.id, convId));

  return c.json(
    {
      id: msg!.id,
      delivery_status: 'queued',
      stream_url: `/api/v1/conversations/${convId}/messages/${msgId}/stream`,
    },
    201,
  );
});
