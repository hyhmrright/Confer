import { z } from 'zod';

export const conversationTypeSchema = z.enum([
  'direct_user_agent',
  'direct_user_user',
  'direct_agent_agent',
  'group',
]);

export const conversationSchema = z.object({
  id: z.string().length(26),
  type: conversationTypeSchema,
  name: z.string().max(255).optional(),
  created_by: z.string().length(26),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
  archived_at: z.coerce.date().optional(),
});

export const participantTypeSchema = z.enum(['user', 'own_agent', 'peer_agent']);
export const participantRoleSchema = z.enum(['member', 'admin', 'observer']);

export const conversationParticipantSchema = z.object({
  id: z.string().length(26),
  conversation_id: z.string().length(26),
  participant_type: participantTypeSchema,
  user_id: z.string().length(26).optional(),
  agent_id: z.string().length(26).optional(),
  peer_id: z.string().length(26).optional(),
  role: participantRoleSchema.default('member'),
  joined_at: z.coerce.date(),
  last_read_at: z.coerce.date().optional(),
  notification: z.enum(['all', 'mentions', 'none']).default('all'),
});

export type ConversationType = z.infer<typeof conversationTypeSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationParticipant = z.infer<typeof conversationParticipantSchema>;
