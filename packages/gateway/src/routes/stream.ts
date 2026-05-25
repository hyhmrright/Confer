import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { authMiddleware } from '../middleware/auth.js';
import { getDb } from '../db/connection.js';
import { messages, agents, conversationParticipants } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { AppError, newId } from '@confer/shared';
import { getProvider } from '@confer/agent-runtime';
import { broadcastToConversation } from '../ws/handler.js';
import type { AppEnv } from '../types.js';

export const streamRoutes = new Hono<AppEnv>();

streamRoutes.use('/*', authMiddleware);

streamRoutes.get('/:conversationId/:messageId', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const conversationId = c.req.param('conversationId');
  const messageId = c.req.param('messageId');

  const [msg] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);

  if (!msg || msg.conversation_id !== conversationId) {
    throw new AppError('not_found', 'Message not found', 404);
  }

  const [participant] = await db
    .select()
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversation_id, conversationId),
        eq(conversationParticipants.user_id, user.sub),
      ),
    )
    .limit(1);

  if (!participant) {
    throw new AppError('forbidden', 'Not a participant of this conversation', 403);
  }

  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.user_id, user.sub))
    .limit(1);

  if (!agent) {
    throw new AppError('not_found', 'Agent not configured', 404);
  }

  return streamSSE(c, async (stream) => {
    try {
      const modelConfig = agent.model_config_json as Record<string, unknown> | null;
      const providerName = (modelConfig?.provider as string) ?? 'anthropic';
      const provider = getProvider(providerName);

      if (!provider) {
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: 'No LLM provider configured' }) });
        return;
      }

      const agentMessages = [
        { role: 'user' as const, content: msg.content ?? '' },
      ];

      let fullContent = '';
      const citations: unknown[] = [];

      for await (const event of provider.stream(agentMessages)) {
        switch (event.type) {
          case 'token':
            if (event.text) {
              fullContent += event.text;
              await stream.writeSSE({ event: 'token', data: JSON.stringify({ text: event.text }) });
            }
            break;
          case 'done':
            break;
        }
      }

      const replyId = newId();
      await db.insert(messages).values({
        id: replyId,
        conversation_id: conversationId,
        sender_type: 'agent',
        sender_id: agent.id,
        content_type: 'text',
        content: fullContent,
        in_reply_to: messageId,
        citations_json: citations.length > 0 ? citations : undefined,
        delivered_at: new Date(),
      });

      broadcastToConversation(conversationId, {
        type: 'message.new',
        data: {
          id: replyId,
          conversation_id: conversationId,
          sender_type: 'agent',
          sender_id: agent.id,
          content: fullContent,
          in_reply_to: messageId,
        },
      });

      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ message_id: replyId }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Stream failed';
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ message }) });
    }
  });
});
