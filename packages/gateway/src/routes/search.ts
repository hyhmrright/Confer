import { AppError } from '@confer/shared';
import { and, desc, eq, ilike, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { conversationParticipants, conversations, messages } from '../db/schema.js';
import { containsPattern } from '../lib/like-pattern.js';
import { parseLimit } from '../lib/pagination.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

export const searchRoutes = new Hono<AppEnv>();

searchRoutes.use('/*', authMiddleware);

// Search the text of every message in threads the caller takes part in,
// archived ones included — finding what an agent told a peer last month is the
// point. Substring matching (ILIKE) rather than Postgres full-text search: the
// built-in configurations do not segment Chinese, so `to_tsvector` would index
// a whole sentence as one token and find nothing inside it.
searchRoutes.get('/messages', async (c) => {
  const user = c.get('user');
  const q = (c.req.query('q') ?? '').trim();
  if (q.length === 0 || q.length > 200) {
    throw new AppError('invalid_query', 'q must be 1–200 characters', 400);
  }
  const limit = parseLimit(c.req.query('limit'), 20, 50);

  const results = await getDb()
    .select({
      message_id: messages.id,
      conversation_id: messages.conversation_id,
      conversation_name: conversations.name,
      sender_type: messages.sender_type,
      content: messages.content,
      created_at: messages.created_at,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversation_id))
    .where(
      and(
        // Tenant boundary: only threads this user is a participant of.
        inArray(
          messages.conversation_id,
          getDb()
            .select({ id: conversationParticipants.conversation_id })
            .from(conversationParticipants)
            .where(eq(conversationParticipants.user_id, user.sub)),
        ),
        eq(conversations.moderation_status, 'visible'),
        eq(messages.moderation_status, 'visible'),
        ilike(messages.content, containsPattern(q)),
      ),
    )
    // Ids are monotonic ULIDs, so this is newest first by insertion order.
    .orderBy(desc(messages.id))
    .limit(limit);

  return c.json({ results });
});
