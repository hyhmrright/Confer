export type MessageHandler = (event: BusEvent) => void | Promise<void>;

export interface BusEvent {
  type: string;
  topic: string;
  data: unknown;
  timestamp: Date;
}

const subscribers = new Map<string, Set<MessageHandler>>();

export function subscribe(topic: string, handler: MessageHandler): () => void {
  let existing = subscribers.get(topic);
  if (!existing) {
    existing = new Set();
    subscribers.set(topic, existing);
  }
  const handlers = existing;
  handlers.add(handler);

  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) {
      subscribers.delete(topic);
    }
  };
}

export async function publish(topic: string, type: string, data: unknown): Promise<void> {
  const event: BusEvent = { type, topic, data, timestamp: new Date() };
  const handlers = subscribers.get(topic);
  if (!handlers) return;

  const promises: Promise<void>[] = [];
  for (const handler of handlers) {
    const result = handler(event);
    if (result instanceof Promise) {
      promises.push(result);
    }
  }

  await Promise.allSettled(promises);
}
