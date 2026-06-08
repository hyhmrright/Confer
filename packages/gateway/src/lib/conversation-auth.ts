import { AppError } from '@confer/shared';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { conversationParticipants, conversations } from '../db/schema.js';

// Membership gate for user-facing conversation routes: the caller must be a
// participant of `convId`, else a 403. Centralizes the participant lookup that
// the conversation and stream read/write paths each repeated inline.
//
// NOTE: this is the membership check. Destructive or owner-only operations
// (consult routes, conversation delete) use the stricter `assertOwnsConversation`
// below — being a participant is not enough to delete a shared conversation.
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

// Ownership gate for destructive/owner-only conversation operations: the caller
// must be the conversation's creator. Returns 404 (not 403) so existence isn't
// leaked to non-owners. A mere participant of a shared conversation cannot pass.
export async function assertOwnsConversation(userId: string, convId: string): Promise<void> {
  const [conv] = await getDb()
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, convId), eq(conversations.created_by, userId)))
    .limit(1);

  if (!conv) {
    throw new AppError('not_found', 'Conversation not found', 404);
  }
}
