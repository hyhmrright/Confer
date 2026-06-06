import { AppError } from '@confer/shared';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { conversationParticipants } from '../db/schema.js';

// Membership gate for user-facing conversation routes: the caller must be a
// participant of `convId`, else a 403. Centralizes the participant lookup that
// the conversation and stream read/write paths each repeated inline.
//
// NOTE: consult.ts deliberately uses the stricter `created_by` ownership check
// (assertOwnsConversation) — do not replace that one with this.
export async function assertIsConversationParticipant(
  userId: string,
  convId: string,
): Promise<void> {
  const db = getDb();
  const [participant] = await db
    .select({ id: conversationParticipants.id })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversation_id, convId),
        eq(conversationParticipants.user_id, userId),
      ),
    )
    .limit(1);

  if (!participant) {
    throw new AppError('forbidden', 'Not a participant', 403);
  }
}
