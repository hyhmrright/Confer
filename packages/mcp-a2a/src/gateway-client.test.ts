import { describe, expect, test } from 'bun:test';
import { GatewayClient } from './gateway-client.js';

const cfg = { gatewayUrl: 'http://gw', username: 'u', password: 'p', defaultWaitSeconds: 25 };

function fakeFetch(handler: (url: string, init?: RequestInit) => Response) {
  return (async (input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}

describe('GatewayClient', () => {
  test('logs in lazily and attaches the bearer token', async () => {
    const calls: string[] = [];
    const client = new GatewayClient(
      cfg,
      fakeFetch((url, init) => {
        calls.push(url);
        if (url.endsWith('/api/v1/auth/login')) {
          return new Response(JSON.stringify({ access_token: 'tok-1' }), { status: 200 });
        }
        expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok-1');
        return new Response(JSON.stringify({ contacts: [] }), { status: 200 });
      }),
    );

    const res = await client.get<{ contacts: unknown[] }>('/api/v1/contacts');
    expect(res).toEqual({ contacts: [] });
    expect(calls[0]).toContain('/auth/login');
  });

  test('re-logs in once on 401 then retries', async () => {
    let unauthorizedOnce = false;
    let logins = 0;
    const client = new GatewayClient(
      cfg,
      fakeFetch((url) => {
        if (url.endsWith('/auth/login')) {
          logins++;
          return new Response(JSON.stringify({ access_token: `tok-${logins}` }), { status: 200 });
        }
        if (!unauthorizedOnce) {
          unauthorizedOnce = true;
          return new Response('nope', { status: 401 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    const res = await client.get<{ ok: boolean }>('/api/v1/contacts');
    expect(res).toEqual({ ok: true });
    expect(logins).toBe(2);
  });
});
