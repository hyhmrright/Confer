import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { generateEd25519KeyPair, publicKeyToMultibase } from '../crypto/keypair.js';
import { buildDIDDocument, didFromDomain } from './document.js';
import { clearDIDCache, resolveDID } from './resolver.js';

const DOMAIN = 'agent.example.com';
const DID = didFromDomain(DOMAIN);

let document: ReturnType<typeof buildDIDDocument>;
const originalFetch = globalThis.fetch;

// Each entry is one scripted fetch response; calls are recorded for assertions.
interface FetchCall {
  url: string;
  headers: Record<string, string>;
}
let calls: FetchCall[];

function mockFetch(responder: (call: FetchCall) => Response): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    const raw = init?.headers as Record<string, string> | undefined;
    if (raw) for (const [k, v] of Object.entries(raw)) headers[k] = v;
    const call = { url: String(input), headers };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

beforeEach(async () => {
  clearDIDCache();
  calls = [];
  const pair = await generateEd25519KeyPair();
  const multibase = await publicKeyToMultibase(pair.publicKey);
  document = buildDIDDocument(DOMAIN, multibase);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  setSystemTime();
});

describe('resolveDID', () => {
  test('cache miss fetches, parses, and caches the DID document', async () => {
    mockFetch(() => jsonResponse(document, { headers: { etag: '"v1"' } }));

    const res = await resolveDID(DID);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.id).toBe(DID);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://${DOMAIN}/.well-known/did.json`);
  });

  test('cache hit within TTL skips the network', async () => {
    mockFetch(() => jsonResponse(document));

    const first = await resolveDID(DID);
    expect(first.ok).toBe(true);
    const second = await resolveDID(DID);
    expect(second.ok).toBe(true);
    // Only the first call hit the network; the second served from cache.
    expect(calls).toHaveLength(1);
  });

  test('304 Not Modified reuses the cached document and sends If-None-Match', async () => {
    // Pin a base time so we can age the cache entry past its 60s TTL and reach
    // the conditional-request branch (which only fires after the TTL expires).
    const base = new Date('2030-01-01T00:00:00Z');
    setSystemTime(base);

    let serve304 = false;
    mockFetch((call) => {
      if (serve304) {
        expect(call.headers['If-None-Match']).toBe('"etag-1"');
        return new Response(null, { status: 304 });
      }
      return jsonResponse(document, { headers: { etag: '"etag-1"' } });
    });

    const first = await resolveDID(DID);
    expect(first.ok).toBe(true);
    expect(calls).toHaveLength(1);

    // Age past TTL (60s) so the next resolve makes a conditional request.
    setSystemTime(new Date(base.getTime() + 120_000));
    serve304 = true;

    const second = await resolveDID(DID);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.id).toBe(DID);
    // A network call was made (conditional), and the cached doc was reused.
    expect(calls).toHaveLength(2);
    expect(calls[1]?.headers['If-None-Match']).toBe('"etag-1"');
  });

  test('HTTP 4xx returns an err result', async () => {
    mockFetch(() => new Response('not found', { status: 404 }));
    const res = await resolveDID(DID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('HTTP 404');
  });

  test('HTTP 5xx returns an err result', async () => {
    mockFetch(() => new Response('boom', { status: 503 }));
    const res = await resolveDID(DID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('HTTP 503');
  });

  test('invalid schema returns an err result', async () => {
    mockFetch(() => jsonResponse({ id: DID, missing: 'verificationMethod' }));
    const res = await resolveDID(DID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('Invalid DID document');
  });

  test('malformed JSON returns an err result', async () => {
    mockFetch(
      () =>
        new Response('not json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const res = await resolveDID(DID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('Failed to resolve DID');
  });

  test('network error returns an err result', async () => {
    mockFetch(() => {
      throw new Error('econnrefused');
    });
    const res = await resolveDID(DID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('econnrefused');
  });

  test('rejects a non-did:web identifier without fetching', async () => {
    mockFetch(() => jsonResponse(document));
    const res = await resolveDID('did:key:z6Mk');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('Invalid DID format');
    expect(calls).toHaveLength(0);
  });

  test('clearDIDCache empties the cache so the next resolve refetches', async () => {
    mockFetch(() => jsonResponse(document));

    await resolveDID(DID);
    expect(calls).toHaveLength(1);
    clearDIDCache();
    await resolveDID(DID);
    expect(calls).toHaveLength(2);
  });
});
