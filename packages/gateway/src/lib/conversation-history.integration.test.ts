import { beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { conversations, messages } from '../db/schema.js';
import { resetDb, type SeededUser, seedUser } from '../test/helpers.js';
import { stableWindowSize, turnHistory } from './conversation-history.js';

describe('stableWindowSize', () => {
  test('shows everything up to the maximum', () => {
    expect(stableWindowSize(0, 20, 10)).toBe(0);
    expect(stableWindowSize(7, 20, 10)).toBe(7);
    expect(stableWindowSize(20, 20, 10)).toBe(20);
  });

  test('past it, drops the oldest in whole steps, so the size cycles 11..20', () => {
    const sizes = [21, 22, 29, 30, 31, 40, 41].map((n) => stableWindowSize(n, 20, 10));
    expect(sizes).toEqual([11, 12, 19, 20, 11, 20, 11]);
  });

  test('keeps the first message shown in place until a whole step has arrived', () => {
    // The index of the first message shown, as the conversation grows by one
    // exchange (two messages) per turn.
    const firstShown = (n: number) => n - stableWindowSize(n, 20, 10);
    expect([22, 24, 26, 28, 30].map(firstShown)).toEqual([10, 10, 10, 10, 10]);
    expect(firstShown(32)).toBe(20);
  });
});

describe('turnHistory', () => {
  let user: SeededUser;
  let convId: string;

  beforeEach(async () => {
    await resetDb();
    user = await seedUser();
    convId = newId();
    await getDb()
      .insert(conversations)
      .values({ id: convId, type: 'direct_user_agent', created_by: user.id });
  });

  async function addMessages(count: number, via?: string): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = newId();
      await getDb()
        .insert(messages)
        .values({
          id,
          conversation_id: convId,
          sender_type: 'user',
          sender_id: user.id,
          content: `m${ids.length}`,
          ...(via ? { via } : {}),
        });
      ids.push(id);
    }
    return ids;
  }

  test('begins at the same message on consecutive turns, which is what a prompt cache reuses', async () => {
    const earlier = await addMessages(22);
    const turnA = await addMessages(1);
    const turnAHistory = await turnHistory(convId, turnA[0] as string);
    await addMessages(1); // the reply
    const turnB = await addMessages(1);
    const turnBHistory = await turnHistory(convId, turnB[0] as string);

    expect(turnAHistory[0]?.id).toBe(earlier[10]);
    expect(turnBHistory[0]?.id).toBe(earlier[10]);
    // Turn B's history starts with all of turn A's, then carries on.
    expect(turnBHistory.slice(0, turnAHistory.length).map((m) => m.id)).toEqual(
      turnAHistory.map((m) => m.id),
    );
  });

  test('never shows more than twenty, and always the newest', async () => {
    const earlier = await addMessages(30);
    const current = await addMessages(1);
    const history = await turnHistory(convId, current[0] as string);
    expect(history).toHaveLength(20);
    expect(history.at(-1)?.id).toBe(earlier[29]);
  });

  test('counts only visible messages, the same rows it then shows', async () => {
    // The count and the fetch share one predicate; split them and a hidden row
    // would size the window for a message it never shows.
    const earlier = await addMessages(25);
    await getDb()
      .update(messages)
      .set({ moderation_status: 'hidden' })
      .where(eq(messages.id, earlier[24] as string));
    const current = await addMessages(1);
    const history = await turnHistory(convId, current[0] as string);
    // 24 visible → the oldest 10 dropped, 14 shown, the hidden one not among them.
    expect(history.map((m) => m.id)).toEqual(earlier.slice(10, 24));
  });

  test('sizes the window from the rows the filter admits, not every row', async () => {
    // The A2A path counts only what crossed the wire. Counting every row and
    // then filtering would shrink the window below what it should show.
    await addMessages(15);
    const wire = await addMessages(25, 'a2a');
    const current = await addMessages(1);
    const history = await turnHistory(convId, current[0] as string, eq(messages.via, 'a2a'));
    // 25 admitted rows → the oldest 10 dropped, 15 shown, all of them a2a.
    expect(history.map((m) => m.id)).toEqual(wire.slice(10));
  });
});
