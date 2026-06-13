import { describe, expect, test } from 'bun:test';
import type { GatewayClient } from '../gateway-client.js';
import { discoverPeer } from './discover.js';

function clientStub(routes: Record<string, unknown>) {
  const calls: Array<{ path: string; body?: unknown }> = [];
  const client = {
    post: async (p: string, body?: unknown) => {
      calls.push({ path: p, body });
      return routes[`POST ${p}`];
    },
    whoami: () => 'u',
  } as unknown as GatewayClient;
  return { client, calls };
}

describe('discoverPeer', () => {
  test('POSTs method+value to /contacts/lookup and returns candidates', async () => {
    const { client, calls } = clientStub({
      'POST /api/v1/contacts/lookup': {
        method: 'domain',
        candidates: [{ id: 'peer1', did: 'did:web:a.example' }],
      },
    });
    const out = await discoverPeer(client, { method: 'domain', value: 'a.example' });
    expect(calls[0]).toEqual({
      path: '/api/v1/contacts/lookup',
      body: { method: 'domain', value: 'a.example' },
    });
    expect(out.method).toBe('domain');
    expect(out.candidates).toHaveLength(1);
  });

  test('passes through a lookup error string', async () => {
    const { client } = clientStub({
      'POST /api/v1/contacts/lookup': {
        method: 'did',
        candidates: [],
        error: 'DID document has no service endpoint',
      },
    });
    const out = await discoverPeer(client, { method: 'did', value: 'did:web:x.example' });
    expect(out.candidates).toEqual([]);
    expect(out.error).toBe('DID document has no service endpoint');
  });
});
