import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { conversationParticipants } from '../db/schema.js';

// The peer_agent participant of a conversation — the one sender whose messages
// count as its replies — or null when it has none. Not an ownership check:
// callers gate access to the conversation first.
export async function conversationPeerId(conversationId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ peer_id: conversationParticipants.peer_id })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversation_id, conversationId),
        eq(conversationParticipants.participant_type, 'peer_agent'),
      ),
    )
    .limit(1);
  return row?.peer_id ?? null;
}
