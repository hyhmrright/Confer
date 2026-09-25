import { z } from 'zod';

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

/**
 * The structured payload of a `system_notice` message.
 *
 * The gateway has no locale context, so it records what happened as a machine
 * code and the client picks the sentence — the same split `permissionRequestEventSchema`
 * makes. `content` still carries English prose as a fallback for any reader that
 * is not our own UI (a peer instance, a raw API consumer).
 */
export const systemNoticeSchema = z.object({
  kind: z.literal('a2a_turn_failed'),
  /** A `ModelConfigError` code, or `agent_error` when the turn itself threw. */
  error: z.string().min(1).max(64),
});

export const sendMessageRequestSchema = z.object({
  content_type: contentTypeSchema.default('text'),
  content: z.string().min(1).max(32000),
  in_reply_to: z.string().length(26).optional(),
  via: z.enum(['claude-code', 'web', 'mobile', 'api']).default('web'),
});

export const consultRequestSchema = z.object({
  question: z.string().min(1).max(8000),
  code_context: z.string().max(20000).optional(),
  language: z.string().max(8).optional(),
});

export type SystemNotice = z.infer<typeof systemNoticeSchema>;
