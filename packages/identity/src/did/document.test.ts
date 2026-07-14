import { describe, expect, test } from 'bun:test';
import {
  buildDIDDocument,
  didDocumentSchema,
  didFromDomain,
  domainFromDid,
  parseDidWeb,
} from './document.js';

const KEY = { keyId: 'did:web:example.com#key-1', publicKeyMultibase: 'zPubKey' };

describe('buildDIDDocument', () => {
  test('builds a schema-valid did:web document', () => {
    const doc = buildDIDDocument({
      did: 'did:web:example.com',
      serviceEndpoint: 'https://example.com/a2a/v1',
      key: KEY,
    });

    expect(doc.id).toBe('did:web:example.com');
    expect(doc['@context']).toContain('https://www.w3.org/ns/did/v1');
    expect(didDocumentSchema.safeParse(doc).success).toBe(true);
  });

  test('embeds the key as an Ed25519 verification method and authorizes it', () => {
    const doc = buildDIDDocument({
      did: 'did:web:example.com',
      serviceEndpoint: 'https://example.com/a2a/v1',
      key: KEY,
    });

    expect(doc.verificationMethod[0]).toEqual({
      id: 'did:web:example.com#key-1',
      type: 'Ed25519VerificationKey2020',
      controller: 'did:web:example.com',
      publicKeyMultibase: 'zPubKey',
    });
    expect(doc.authentication).toEqual(['did:web:example.com#key-1']);
  });

  test('advertises the A2A service endpoint', () => {
    const doc = buildDIDDocument({
      did: 'did:web:example.com',
      serviceEndpoint: 'https://example.com/a2a/v1',
      key: KEY,
    });
    expect(doc.service?.[0]?.serviceEndpoint).toBe('https://example.com/a2a/v1');
  });

  test('omits verification material but keeps the service when no key is given', () => {
    const doc = buildDIDDocument({
      did: 'did:web:example.com',
      serviceEndpoint: 'https://example.com/a2a/v1',
    });

    expect(doc.verificationMethod).toEqual([]);
    expect(doc.authentication).toEqual([]);
    expect(doc.service?.[0]?.serviceEndpoint).toBe('https://example.com/a2a/v1');
    expect(didDocumentSchema.safeParse(doc).success).toBe(true);
  });
});

describe('parseDidWeb', () => {
  test('maps a bare-domain DID to its .well-known document', () => {
    expect(parseDidWeb('did:web:acme.com')).toEqual({
      hostname: 'acme.com',
      url: 'https://acme.com/.well-known/did.json',
    });
  });

  test('maps a sub-identifier DID to its path document (no .well-known)', () => {
    expect(parseDidWeb('did:web:acme.com:agents:laowang')).toEqual({
      hostname: 'acme.com',
      url: 'https://acme.com/agents/laowang/did.json',
    });
  });

  test('decodes a percent-encoded port into the authority but not the hostname', () => {
    expect(parseDidWeb('did:web:example.com%3A3000:user:alice')).toEqual({
      hostname: 'example.com',
      url: 'https://example.com:3000/user/alice/did.json',
    });
  });

  test('treats a bare colon segment as a path segment, not a port', () => {
    // Per the did:web spec, only a %3A-encoded colon in the authority is a port;
    // a bare `:8080` is a path segment.
    expect(parseDidWeb('did:web:example.com:8080')).toEqual({
      hostname: 'example.com',
      url: 'https://example.com/8080/did.json',
    });
  });

  test('returns null for non-did:web and malformed inputs', () => {
    expect(parseDidWeb('did:key:z6Mk')).toBeNull();
    expect(parseDidWeb('not-a-did')).toBeNull();
    expect(parseDidWeb('did:web:')).toBeNull();
  });

  test('rejects a percent-decoded authority that smuggles userinfo (SSRF)', () => {
    // `%40` decodes to `@`, so a naive `https://${authority}${path}` build would
    // put the safe-looking `public.example.com` before `@` and the REAL connect
    // target (a cloud metadata address) after it — the URL parser treats
    // everything before `@` as userinfo, so only `169.254.169.254` is ever
    // actually dialed. This must be rejected outright, not resolved to either
    // host, so a caller can never mistake it for a safe address.
    expect(parseDidWeb('did:web:public.example.com%40169.254.169.254')).toBeNull();
    expect(parseDidWeb('did:web:user%3Apass%40evil.example')).toBeNull();
  });

  test('parses a percent-encoded bracketed IPv6 authority (legitimate URL notation)', () => {
    // `[::1]` is legitimate bracket notation for an IPv6 literal inside a URL
    // authority — unlike userinfo, there is nothing to reject here at the
    // parsing level. Whether the resulting hostname is a private/reserved
    // address is the SSRF guard's job (see ssrf-guard.ts / resolver.test.ts),
    // not parseDidWeb's — this test only pins the structural parse.
    expect(parseDidWeb('did:web:%5B%3A%3A1%5D')).toEqual({
      hostname: '[::1]',
      url: 'https://[::1]/.well-known/did.json',
    });
  });
});

describe('didFromDomain', () => {
  test('prefixes the domain with did:web', () => {
    expect(didFromDomain('example.com')).toBe('did:web:example.com');
  });
});

describe('domainFromDid', () => {
  test('extracts the authority host from a bare-domain DID', () => {
    expect(domainFromDid('did:web:example.com')).toBe('example.com');
  });

  test('returns the authority host of a sub-identifier DID (path segments are not the host)', () => {
    // The path segments live in the resolved URL (see parseDidWeb), not here —
    // domainFromDid only ever returns the authority host.
    expect(domainFromDid('did:web:acme.com:agents:laowang')).toBe('acme.com');
  });

  test('strips a percent-encoded port from the authority host', () => {
    expect(domainFromDid('did:web:example.com%3A3000:user:alice')).toBe('example.com');
  });

  test('returns null for non-did:web inputs', () => {
    expect(domainFromDid('did:key:z6Mk')).toBeNull();
    expect(domainFromDid('not-a-did')).toBeNull();
  });
});
