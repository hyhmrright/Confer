import { z } from 'zod';

export const senderTypeSchema = z.enum(['user', 'own_agent', 'peer_agent', 'system']);

export const contentTypeSchema = z.enum([
  'text',
  'code',
  'permission_request',
  'tool_call',
  'tool_result',
  'file',
  'citation',
  'system_notice',
]);

export const citationSchema = z.object({
  source: z.string(),
  url: z.string().url().optional(),
  page: z.number().int().optional(),
  passage: z.string().optional(),
  trust_level: z.enum(['authoritative', 'verified', 'unverified']),
});

export const messageSchema = z.object({
  id: z.string().length(26),
  conversation_id: z.string().length(26),
  sender_type: senderTypeSchema,
  sender_id: z.string().length(26),
  sender_did: z.string().optional(),
  content_type: contentTypeSchema.default('text'),
  content: z.string().optional(),
  content_json: z.unknown().optional(),
  in_reply_to: z.string().length(26).optional(),
  thread_root: z.string().length(26).optional(),
  citations: z.array(citationSchema).optional(),
  language: z.string().max(8).optional(),
  translation: z
    .object({
      from: z.string(),
      to: z.string(),
      provider: z.string(),
    })
    .optional(),
  via: z.enum(['claude-code', 'web', 'mobile', 'api']).optional(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
  deleted_at: z.coerce.date().optional(),
});

export const sendMessageRequestSchema = z.object({
  content_type: contentTypeSchema.default('text'),
  content: z.string().min(1).max(32000),
  in_reply_to: z.string().length(26).optional(),
  via: z.enum(['claude-code', 'web', 'mobile', 'api']).default('web'),
});

export type Message = z.infer<typeof messageSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;
