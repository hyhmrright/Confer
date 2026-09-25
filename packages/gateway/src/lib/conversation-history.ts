import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { messages } from '../db/schema.js';
import { countOf } from './pagination.js';

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
 *
 * `only` narrows which rows count, inside the same window query — filtering
 * after the fact would hand back fewer than `limit` rows whenever the newest
 * ones were filtered out.
 */
export async function historyBefore(
  conversationId: string,
  beforeId: string | undefined,
  limit: number,
  only?: SQL,
): Promise<MessageRow[]> {
  const rows = await getDb()
    .select()
    .from(messages)
    .where(visibleBefore(conversationId, beforeId, only))
    .orderBy(desc(messages.id))
    .limit(limit);

  return rows.reverse();
}

function visibleBefore(
  conversationId: string,
  beforeId: string | undefined,
  only?: SQL,
): SQL | undefined {
  return and(
    eq(messages.conversation_id, conversationId),
    eq(messages.moderation_status, 'visible'),
    beforeId ? lt(messages.id, beforeId) : undefined,
    only,
  );
}

/** The most history a turn is shown. */
const TURN_HISTORY_MAX = 20;
/** How many of the oldest messages leave the window at once. */
const TURN_HISTORY_STEP = 10;

/**
 * How many of `total` earlier messages a turn is shown: all of them up to
 * `max`, and past that a count whose START only moves in whole `step`s.
 *
 * The plain rule — always the newest `max` — drops the oldest message every
 * time one arrives, so the history the model sees begins somewhere new on
 * every turn. Every provider's prompt cache is a prefix match, so from the
 * moment a conversation outgrew the window, none of its history was ever
 * reused. Here the first message shown stays put while the conversation grows
 * by `step`, then jumps forward by `step` at once: with the defaults, a long
 * conversation shows between 11 and 20 messages, and five turns in a row share
 * the same opening.
 */
export function stableWindowSize(total: number, max: number, step: number): number {
  if (total <= max) return total;
  const dropped = Math.ceil((total - max) / step) * step;
  return total - dropped;
}

/**
 * The history an agent turn is shown: `historyBefore`, with the window sized by
 * `stableWindowSize` so its opening survives from one turn to the next. Paging
 * through a conversation is a different question and keeps `historyBefore`.
 */
export async function turnHistory(
  conversationId: string,
  beforeId: string,
  only?: SQL,
): Promise<MessageRow[]> {
  const total = await countOf(messages, visibleBefore(conversationId, beforeId, only));
  const size = stableWindowSize(total, TURN_HISTORY_MAX, TURN_HISTORY_STEP);
  return size === 0 ? [] : historyBefore(conversationId, beforeId, size, only);
}
