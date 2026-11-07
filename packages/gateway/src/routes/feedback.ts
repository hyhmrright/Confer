import { AppError, newId } from '@confer/shared';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { answerFeedback, messages } from '../db/schema.js';
import { assertOwnsConversation } from '../lib/tenant.js';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import type { AppEnv } from '../types.js';

export const feedbackRoutes = new Hono<AppEnv>();
feedbackRoutes.use('/*', authMiddleware);
feedbackRoutes.post(
  '/',
  rateLimit<AppEnv>(30, 60_000, { keyBy: (c) => `feedback:${c.get('user').sub}` }),
  async (c) => {
    const body = z
      .object({
        message_id: z.string().length(26),
        kind: z.enum(['incorrect_answer', 'incorrect_memory', 'outdated_source']),
        note: z.string().trim().min(1).max(4000),
      })
      .parse(await c.req.json());
    const [message] = await getDb()
      .select()
      .from(messages)
      .where(and(eq(messages.id, body.message_id), eq(messages.moderation_status, 'visible')));
    if (!message) throw new AppError('not_found', 'Message not found', 404);
    await assertOwnsConversation(c.get('user').sub, message.conversation_id);
    const [feedback] = await getDb()
      .insert(answerFeedback)
      .values({ id: newId(), user_id: c.get('user').sub, ...body })
      .returning();
    return c.json({ feedback }, 201);
  },
);
feedbackRoutes.get('/', async (c) =>
  c.json({
    feedback: await getDb()
      .select()
      .from(answerFeedback)
      .where(eq(answerFeedback.user_id, c.get('user').sub))
      .orderBy(desc(answerFeedback.id))
      .limit(100),
  }),
);
