import { describe, expect, test } from 'bun:test';
import type { GatewayClient } from '../gateway-client.js';
import { askAgent } from './consult.js';

function clientStub(routes: Record<string, unknown>): GatewayClient {
  return {
    post: async (p: string) => routes[`POST ${p}`],
    get: async (p: string) => routes[`GET ${p.split('?')[0]}`],
    whoami: () => 'u',
  } as unknown as GatewayClient;
}

describe('askAgent', () => {
  test('returns answer when reply arrives within wait', async () => {
    const client = clientStub({
      'POST /api/v1/consult/peer1': { conversation_id: 'c1', message_id: 'm1', status: 'sent' },
      'GET /api/v1/consult/c1/reply': { status: 'answered', message: { content: 'use ULID' } },
    });
    const out = await askAgent(client, { peerId: 'peer1', question: 'id format?', waitSeconds: 5 });
    expect(out.status).toBe('answered');
    expect(out.answer).toBe('use ULID');
    expect(out.conversationId).toBe('c1');
  });

  test('returns pending ticket when no wait requested', async () => {
    const client = clientStub({
      'POST /api/v1/consult/peer1': { conversation_id: 'c1', message_id: 'm1', status: 'sent' },
    });
    const out = await askAgent(client, { peerId: 'peer1', question: 'q', waitSeconds: 0 });
    expect(out.status).toBe('pending');
    expect(out.conversationId).toBe('c1');
    expect(out.messageId).toBe('m1');
  });

  test('surfaces delivery failure', async () => {
    const client = clientStub({
      'POST /api/v1/consult/peer1': {
        conversation_id: 'c1',
        message_id: 'm1',
        status: 'failed',
        error: 'peer_no_endpoint',
      },
    });
    const out = await askAgent(client, { peerId: 'peer1', question: 'q', waitSeconds: 5 });
    expect(out.status).toBe('failed');
    expect(out.error).toBe('peer_no_endpoint');
  });

  test('returns pending when wait elapses without an answer', async () => {
    const client = clientStub({
      'POST /api/v1/consult/peer1': { conversation_id: 'c1', message_id: 'm1', status: 'sent' },
      'GET /api/v1/consult/c1/reply': { status: 'pending' },
    });
    const out = await askAgent(client, { peerId: 'peer1', question: 'q', waitSeconds: 5 });
    expect(out.status).toBe('pending');
  });
});
