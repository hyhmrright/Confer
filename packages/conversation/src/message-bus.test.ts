import { describe, expect, test } from 'bun:test';
import { type BusEvent, publish, subscribe } from './message-bus.js';

describe('message-bus', () => {
  test('delivers a published event to a subscriber', async () => {
    let received: BusEvent | undefined;
    const unsub = subscribe('topic-a', (e) => {
      received = e;
    });

    await publish('topic-a', 'msg.created', { id: 1 });

    expect(received).toMatchObject({ type: 'msg.created', topic: 'topic-a', data: { id: 1 } });
    expect(received?.timestamp).toBeInstanceOf(Date);
    unsub();
  });

  test('fans out to every subscriber on the topic', async () => {
    const calls: string[] = [];
    const unsub1 = subscribe('topic-b', () => {
      calls.push('one');
    });
    const unsub2 = subscribe('topic-b', () => {
      calls.push('two');
    });

    await publish('topic-b', 'evt', null);

    expect(calls.sort()).toEqual(['one', 'two']);
    unsub1();
    unsub2();
  });

  test('stops delivery after unsubscribe', async () => {
    let count = 0;
    const unsub = subscribe('topic-c', () => {
      count++;
    });

    await publish('topic-c', 'evt', null);
    unsub();
    await publish('topic-c', 'evt', null);

    expect(count).toBe(1);
  });

  test('unsubscribing one handler leaves the others active', async () => {
    const calls: string[] = [];
    const unsubKept = subscribe('topic-d', () => {
      calls.push('kept');
    });
    const unsubDropped = subscribe('topic-d', () => {
      calls.push('dropped');
    });

    unsubDropped();
    await publish('topic-d', 'evt', null);

    expect(calls).toEqual(['kept']);
    unsubKept();
  });

  test('publishing to a topic with no subscribers is a no-op', async () => {
    await expect(publish('topic-empty', 'evt', null)).resolves.toBeUndefined();
  });

  test('awaits async handlers before resolving', async () => {
    let done = false;
    const unsub = subscribe('topic-e', async () => {
      await Promise.resolve();
      done = true;
    });

    await publish('topic-e', 'evt', null);

    expect(done).toBe(true);
    unsub();
  });
});
