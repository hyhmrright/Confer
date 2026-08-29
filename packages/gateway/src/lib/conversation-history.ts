import { and, desc, eq, lt } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { messages } from '../db/schema.js';

type MessageRow = typeof messages.$inferSelect;

/**
 * The `limit` visible messages immediately before `beforeId`, oldest-first —
 * the window a turn hands the model, and a page of a conversation's history.
 * An undefined `beforeId` means the newest `limit`, with nothing before it.
 *
 * All three callers had written this query themselves and each had one of the
 * two bugs below, which is why it lives in one place now.
 *
 * It takes the NEWEST rows and reverses them. Ordering ascending and taking the
 * first `limit` hands back the OLDEST instead, so past that many messages the
 * agent re-reads the start of the conversation every turn and never sees
 * anything recent. That was fixed on the chat path and left on the A2A one,
 * where it stayed invisible only because every inbound message used to open a
 * conversation of its own.
 *
 * And the rows are filtered and ordered by the SAME key. They used to be
 * filtered by id and ordered by created_at, which are two different orderings,
 * and they disagreed often enough to drop the newest message from the window
 * about half the time on a fast machine. The id is the right one of the two:
 * `newId` is monotonic, so it is exact insertion order, whereas created_at is
 * `now()` — the TRANSACTION timestamp, shared by every row a transaction
 * writes — and loses its microseconds on the way back into a JS Date, so a
 * value read from one row cannot even be compared against another reliably.
 */
export async function historyBefore(
  conversationId: string,
  beforeId: string | undefined,
  limit: number,
): Promise<MessageRow[]> {
  const rows = await getDb()
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversation_id, conversationId),
        eq(messages.moderation_status, 'visible'),
        beforeId ? lt(messages.id, beforeId) : undefined,
      ),
    )
    .orderBy(desc(messages.id))
    .limit(limit);

  return rows.reverse();
}
