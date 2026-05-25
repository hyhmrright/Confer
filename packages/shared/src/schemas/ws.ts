import { z } from 'zod';

export const wsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({
    type: z.literal('subscribe.conversation'),
    data: z.object({ conversation_id: z.string().length(26) }),
  }),
  z.object({
    type: z.literal('unsubscribe.conversation'),
    data: z.object({ conversation_id: z.string().length(26) }),
  }),
  z.object({
    type: z.literal('typing.start'),
    data: z.object({ conversation_id: z.string().length(26) }),
  }),
  z.object({
    type: z.literal('typing.stop'),
    data: z.object({ conversation_id: z.string().length(26) }),
  }),
  z.object({
    type: z.literal('read.ack'),
    data: z.object({
      conversation_id: z.string().length(26),
      message_id: z.string().length(26),
    }),
  }),
]);

export const wsServerMessageTypeSchema = z.enum([
  'pong',
  'message.new',
  'message.updated',
  'message.deleted',
  'typing.update',
  'presence.update',
  'permission.request',
  'agent.status',
  'conversation.updated',
]);

export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;
export type WsServerMessageType = z.infer<typeof wsServerMessageTypeSchema>;

export interface WsServerMessage<T = unknown> {
  type: WsServerMessageType;
  data: T;
}
