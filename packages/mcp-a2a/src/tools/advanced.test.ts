import { describe, expect, test } from 'bun:test';
import type { GatewayClient } from '../gateway-client.js';
import { askMultiple } from './advanced.js';

// Drive askMultiple through askAgent's POST: with waitSeconds 0 each ask returns
// a pending ticket after only the initiate POST, so the GET reply is never hit.
function clientStub(post: (path: string, body?: unknown) => Promise<unknown>): GatewayClient {
  return {
    post,
    get: async () => {
      throw new Error('get should not be called when waitSeconds is 0');
    },
    whoami: () => 'u',
  } as unknown as GatewayClient;
}

function sentResponse(peerId: string) {
  return { conversation_id: `c-${peerId}`, message_id: `m-${peerId}`, status: 'sent' as const };
}

describe('askMultiple', () => {
  test('returns one result per peer, tagged with its peerId', async () => {
    const client = clientStub(async (path) => {
      const peerId = path.split('/').pop() ?? '';
      return sentResponse(peerId);
    });

    const results = await askMultiple(client, {
      peerIds: ['p1', 'p2', 'p3'],
      question: 'q',
      waitSeconds: 0,
    });

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.peerId)).toEqual(['p1', 'p2', 'p3']);
    expect(results.every((r) => r.status === 'pending')).toBe(true);
    expect(results[0]?.conversationId).toBe('c-p1');
  });

  test('caps the fan-out at 5 peers', async () => {
    const seen: string[] = [];
    const client = clientStub(async (path) => {
      const peerId = path.split('/').pop() ?? '';
      seen.push(peerId);
      return sentResponse(peerId);
    });

    const results = await askMultiple(client, {
      peerIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
      question: 'q',
      waitSeconds: 0,
    });

    expect(results).toHaveLength(5);
    expect(results.map((r) => r.peerId)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(seen).not.toContain('p6');
  });

  test('isolates a failing peer without sinking the batch', async () => {
    const client = clientStub(async (path) => {
      const peerId = path.split('/').pop() ?? '';
      if (peerId === 'p2') throw new Error('peer p2 exploded');
      return sentResponse(peerId);
    });

    const results = await askMultiple(client, {
      peerIds: ['p1', 'p2', 'p3'],
      question: 'q',
      waitSeconds: 0,
    });

    expect(results).toHaveLength(3);
    const failed = results.find((r) => r.peerId === 'p2');
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('peer p2 exploded');
    expect(results.filter((r) => r.status === 'pending')).toHaveLength(2);
  });
});
