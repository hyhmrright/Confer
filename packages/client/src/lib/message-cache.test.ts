import { beforeEach, describe, expect, test } from 'bun:test';
import type { Message } from '../stores/chat.js';
import {
  clearMessageCache,
  messageCacheKey,
  readMessageCache,
  removeMessageCache,
  writeMessageCache,
} from './message-cache.js';

const key = messageCacheKey('https://one.example', 'alice', 'thread');
const messages: Message[] = Array.from({ length: 120 }, (_, i) => ({
  id: String(i),
  conversation_id: 'thread',
  sender_type: 'user',
  sender_id: 'alice',
  content: String(i),
  content_type: 'text',
  created_at: new Date().toISOString(),
}));
beforeEach(clearMessageCache);

describe('message cache', async () => {
  test('keeps only the latest 100 messages across reloads', async () => {
    await writeMessageCache(key, messages);
    const restored = await readMessageCache(key);
    expect(restored).toHaveLength(100);
    expect(restored[0].id).toBe('20');
    expect(restored[99].id).toBe('119');
  });
  test('isolates both accounts and gateway instances', async () => {
    await writeMessageCache(key, messages);
    expect(await readMessageCache(messageCacheKey('https://one.example', 'bob', 'thread'))).toEqual(
      [],
    );
    expect(
      await readMessageCache(messageCacheKey('https://two.example', 'alice', 'thread')),
    ).toEqual([]);
  });
  test('rejects corrupt, invalid and expired entries', async () => {
    for (const raw of [
      '{',
      '{}',
      JSON.stringify({ savedAt: Date.now(), messages: [{}] }),
      JSON.stringify({ savedAt: Date.now() - 8 * 86400000, messages: messages.slice(0, 1) }),
    ]) {
      localStorage.setItem(key, raw);
      expect(await readMessageCache(key)).toEqual([]);
    }
  });
  test('clears deleted conversations and all message data on logout without touching settings', async () => {
    localStorage.setItem('cache-test-settings', 'keep');
    await writeMessageCache(key, messages);
    await removeMessageCache(key);
    expect(await readMessageCache(key)).toEqual([]);
    await writeMessageCache(key, messages);
    await clearMessageCache();
    expect(await readMessageCache(key)).toEqual([]);
    expect(localStorage.getItem('cache-test-settings')).toBe('keep');
    localStorage.removeItem('cache-test-settings');
  });
  test('bounds total stored conversations', async () => {
    for (let i = 0; i < 25; i++)
      await writeMessageCache(messageCacheKey('one', 'alice', String(i)), messages);
    expect(
      Object.keys(localStorage).filter((k) => k.startsWith('confer_messages_v1:')).length,
    ).toBeLessThanOrEqual(20);
  });
});
