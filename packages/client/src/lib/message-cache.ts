import { z } from 'zod';
import type { Message } from '../stores/chat.js';
import { cacheStorage } from './cache-storage.js';

const PREFIX = 'confer_messages_v1:';
const MAX_THREADS = 20;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const cachedMessage = z.object({
  id: z.string(),
  conversation_id: z.string(),
  sender_type: z.string(),
  sender_id: z.string(),
  content: z.string().nullable(),
  content_type: z.string(),
  created_at: z.string(),
  in_reply_to: z.string().optional(),
  content_json: z.unknown().optional(),
  citations: z
    .array(
      z.object({
        source: z.string(),
        url: z.string().optional(),
        page: z.number().optional(),
        passage: z.string().optional(),
        trust_level: z.string().optional(),
      }),
    )
    .optional(),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        filename: z.string(),
        content_type: z.string().nullable(),
        size_bytes: z.number().nullable(),
      }),
    )
    .optional(),
});
const entry = z.object({ savedAt: z.number(), messages: z.array(cachedMessage).max(100) });

export function messageCacheKey(origin: string, userId: string, conversationId: string): string {
  return PREFIX + JSON.stringify([origin, userId, conversationId]);
}

// Serializing storage operations also ensures logout's clear runs after every
// preceding write, even when the native database is still opening.
let pending = Promise.resolve();
function enqueue<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  const result = pending.then(work).catch(() => fallback);
  pending = result.then(() => {});
  return result;
}

/** A disposable snapshot: failure or a full disk must never break chat. */
export function readMessageCache(key: string): Promise<Message[]> {
  return enqueue(async () => {
    const storage = await cacheStorage();
    const raw = await storage.getItem(key);
    if (!raw) return [];
    let parsed: z.infer<typeof entry>;
    try {
      parsed = entry.parse(JSON.parse(raw));
    } catch {
      await storage.removeItem(key);
      return [];
    }
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      await storage.removeItem(key);
      return [];
    }
    return parsed.messages;
  }, []);
}

export function writeMessageCache(key: string, messages: Message[]): Promise<void> {
  // Snapshot now: queued operations must not observe later in-memory mutations.
  const value = JSON.stringify({ savedAt: Date.now(), messages: messages.slice(-100) });
  return enqueue(async () => {
    const storage = await cacheStorage();
    await storage.setItem(key, value);
    const keys = (await storage.keys()).filter((k) => k.startsWith(PREFIX));
    const ages = await Promise.all(
      keys.map(async (k) => {
        try {
          return {
            key: k,
            age: Number(JSON.parse((await storage.getItem(k)) ?? '{}').savedAt) || 0,
          };
        } catch {
          return { key: k, age: 0 };
        }
      }),
    );
    ages.sort((a, b) => b.age - a.age);
    for (const stale of ages.slice(MAX_THREADS)) await storage.removeItem(stale.key);
  }, undefined);
}

export function removeMessageCache(key: string): Promise<void> {
  return enqueue(async () => (await cacheStorage()).removeItem(key), undefined);
}

export function clearMessageCache(): Promise<void> {
  return enqueue(async () => {
    const storage = await cacheStorage();
    for (const key of await storage.keys()) {
      if (key.startsWith(PREFIX)) await storage.removeItem(key);
    }
  }, undefined);
}
