import { z } from 'zod';

export const conversationTypeSchema = z.enum([
  'direct_user_agent',
  'direct_user_user',
  'direct_agent_agent',
  'group',
]);

/**
 * Body of `POST /api/v1/conversations`.
 *
 * `type` reached a varchar(32) unchecked, so a caller chose it freely — the
 * value that decides how a thread is rendered and which paths treat it as an
 * A2A or probe thread. `name` was equally unchecked against its column, which
 * turned an over-long title into a 500. `probe` is deliberately absent: probe
 * threads are opened by the probe route itself, never asked for.
 */
export const createConversationRequestSchema = z.object({
  type: conversationTypeSchema.default('direct_user_agent'),
  name: z.string().max(255).nullish(),
});

// `conversationSchema` and the participant schemas stood here, mirroring the
// `conversations` and `conversation_participants` rows. Nothing imported them,
// and the participant one had already drifted — it lists `participant_type` as
// `user | own_agent | peer_agent` while `db/schema.ts` writes `'user'` and
// `'peer_agent'` only. Row shapes come from Drizzle; only the wire shapes above
// belong here.
//
// The type vocabulary survives because it now has a job: it is what validates
// the `type` a caller may ask for. Note the table also holds `consult` and
// `probe` threads, which the routes create themselves and no caller may request.
