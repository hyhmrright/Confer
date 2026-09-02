import { describe, expect, test } from 'bun:test';
import { apiRequest } from './test/helpers.js';

// CORS used to be `app.use('*', cors())` — a wildcard on every route, the API
// included. Nothing here needs it: the web client is served from the same origin
// and calls `/api/v1` as a relative path, and peers and the MCP server are not
// browsers. What it did grant was permission for any page a user happens to have
// open to read this instance's API responses, which matters most for the
// localhost and LAN installs the quick start produces — there the attacker's
// page is running inside the network boundary the instance is relying on.
//
// Asserting on the header rather than the middleware list is deliberate: the
// header is what a browser acts on, and a route added under a new prefix would
// silently escape a test that only checked how the middleware was registered.
const ORIGIN = { origin: 'https://evil.example' };

async function allowOriginFor(path: string): Promise<string | null> {
  const res = await apiRequest(path, { headers: ORIGIN });
  return res.headers.get('access-control-allow-origin');
}

describe('CORS scope', () => {
  test('the public identity documents are readable cross-origin', async () => {
    // These four exist to be fetched by strangers — that is what did:web
    // resolution and agent discovery are — and carry no credentials.
    expect(await allowOriginFor('/.well-known/did.json')).toBe('*');
    expect(await allowOriginFor('/.well-known/agents.json')).toBe('*');
    expect(await allowOriginFor('/agents/someone/did.json')).toBe('*');
    expect(await allowOriginFor('/a2a/v1/agent-facts/did:web:example.com:agents:someone')).toBe(
      '*',
    );
  });

  test('the API is not', async () => {
    for (const path of [
      '/api/v1/users/me',
      '/api/v1/conversations',
      '/api/v1/admin/users',
      '/api/v1/knowledge-bases',
    ]) {
      expect(await allowOriginFor(path)).toBeNull();
    }
  });

  // Signed server-to-server traffic. A browser has no business here either, and
  // the agent-facts document above is the one exception carved out of it.
  test('nor is the A2A message endpoint', async () => {
    expect(await allowOriginFor('/a2a/v1/message')).toBeNull();
  });

  // The desktop and mobile bundles are the one browser client that cannot be
  // same-origin: a Tauri app serves its own assets and calls a gateway named at
  // runtime. Both spellings are load-bearing — Windows, Linux and Android use
  // the http one — and getting either wrong means a build that installs, opens,
  // and can never sign in.
  test('the API answers the two origins a Tauri bundle can have', async () => {
    for (const origin of ['tauri://localhost', 'http://tauri.localhost']) {
      const res = await apiRequest('/api/v1/users/me', { headers: { origin } });
      expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    }
  });

  // Echoing the request's own origin is how the allowlist is expressed, so the
  // failure mode to guard is echoing one that isn't on it.
  test('and no other origin, including a near miss', async () => {
    for (const origin of ['https://tauri.localhost', 'http://tauri.localhost.evil.example']) {
      const res = await apiRequest('/api/v1/users/me', { headers: { origin } });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
  });

  // Every API call the client makes carries `Authorization`, which is not a
  // CORS-safelisted header, so each one is preceded by a preflight. If OPTIONS
  // does not answer, nothing behind it is ever attempted.
  test('preflight from a bundle is answered', async () => {
    const res = await apiRequest('/api/v1/users/me', {
      method: 'OPTIONS',
      headers: {
        origin: 'tauri://localhost',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('tauri://localhost');
    expect(res.headers.get('access-control-allow-headers')).toBe('authorization');
    // Without a max-age the client pays a second round trip on every single
    // call, since `Authorization` is never CORS-safelisted.
    expect(res.headers.get('access-control-max-age')).toBe('3600');
  });
});
