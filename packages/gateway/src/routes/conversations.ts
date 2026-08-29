import {
  AppError,
  createConversationRequestSchema,
  newId,
  sendMessageRequestSchema,
} from '@confer/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { conversationParticipants, conversations, messages } from '../db/schema.js';
import { historyBefore } from '../lib/conversation-history.js';
import { parseLimit } from '../lib/pagination.js';
import { assertIsConversationParticipant, assertOwnsConversation } from '../lib/tenant.js';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
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
  const body = createConversationRequestSchema.parse(await c.req.json());

  const convId = newId();
  const [conv] = await db
    .insert(conversations)
    .values({
      id: convId,
      type: body.type,
      name: body.name ?? undefined,
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
  const user = c.get('user');
  const db = getDb();
  const convId = c.req.param('id');
  const [conv] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, convId),
        // A hidden conversation reads as not-found for regular users.
        eq(conversations.moderation_status, 'visible'),
      ),
    )
    .limit(1);

  if (!conv) {
    throw new AppError('not_found', 'Conversation not found', 404);
  }

  await assertIsConversationParticipant(user.sub, convId);

  return c.json({ conversation: conv });
});

conversationRoutes.get('/:id/messages', async (c) => {
  const user = c.get('user');
  const convId = c.req.param('id');
  const before = c.req.query('before');
  const limit = parseLimit(c.req.query('limit'), 50, 100);

  await assertIsConversationParticipant(user.sub, convId);

  // The cursor and the ordering are the same key — see historyBefore. This
  // paged by id while ordering by created_at, and the two disagreed often
  // enough for a page to skip a message or repeat one.
  return c.json({ messages: await historyBefore(convId, before, limit) });
});

conversationRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const convId = c.req.param('id');

  // Deleting wipes the conversation for every participant, so restrict it to the
  // creator — a mere participant must not be able to destroy a shared thread.
  await assertOwnsConversation(user.sub, convId);

  // One transaction, because these three used to be three statements and a
  // crash between them left the conversation row standing with no participants
  // — a thread nobody can read and nobody can be added back to. An inbound A2A
  // conversation id is derived from the peer's thread id, so that dead row
  // would be found again by the peer's next message and quietly collect it.
  await db.transaction(async (tx) => {
    await tx
      .delete(conversationParticipants)
      .where(eq(conversationParticipants.conversation_id, convId));
    await tx.delete(messages).where(eq(messages.conversation_id, convId));
    await tx.delete(conversations).where(eq(conversations.id, convId));
  });

  return c.json({ ok: true });
});

conversationRoutes.post(
  '/:id/messages',
  // 60 messages/min per user (docs/05-api.md). `authMiddleware` already ran via
  // the `/*` guard, so `c.get('user')` is populated here. Keyed by user (not IP)
  // so one user's flood can't throttle another sharing nginx's upstream IP.
  rateLimit<AppEnv>(60, 60_000, { keyBy: (c) => `msg:${c.get('user').sub}` }),
  async (c) => {
    const user = c.get('user');
    const db = getDb();
    const convId = c.req.param('id');

    await assertIsConversationParticipant(user.sub, convId);

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
  },
);
