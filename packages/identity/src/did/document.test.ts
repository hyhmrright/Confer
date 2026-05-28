import { describe, expect, test } from 'bun:test';
import {
  buildDIDDocument,
  didDocumentSchema,
  didFromDomain,
  domainFromDid,
} from './document.js';

describe('buildDIDDocument', () => {
  test('builds a schema-valid did:web document for a domain', () => {
    const doc = buildDIDDocument('example.com', 'zPubKey');

    expect(doc.id).toBe('did:web:example.com');
    expect(doc['@context']).toContain('https://www.w3.org/ns/did/v1');
    expect(didDocumentSchema.safeParse(doc).success).toBe(true);
  });

  test('embeds the key as an Ed25519 verification method', () => {
    const doc = buildDIDDocument('example.com', 'zPubKey');
    const method = doc.verificationMethod[0];

    expect(method).toEqual({
      id: 'did:web:example.com#key-1',
      type: 'Ed25519VerificationKey2020',
      controller: 'did:web:example.com',
      publicKeyMultibase: 'zPubKey',
    });
  });

  test('advertises the A2A service endpoint', () => {
    const doc = buildDIDDocument('example.com', 'zPubKey');
    expect(doc.service?.[0]?.serviceEndpoint).toBe('https://example.com/a2a/v1');
  });
});

describe('didFromDomain', () => {
  test('prefixes the domain with did:web', () => {
    expect(didFromDomain('example.com')).toBe('did:web:example.com');
  });
});

describe('domainFromDid', () => {
  test('extracts the domain from a did:web identifier', () => {
    expect(domainFromDid('did:web:example.com')).toBe('example.com');
  });

  test('drops a path/port suffix after the domain', () => {
    expect(domainFromDid('did:web:example.com:8080')).toBe('example.com');
  });

  test('returns null for non-did:web inputs', () => {
    expect(domainFromDid('did:key:z6Mk')).toBeNull();
    expect(domainFromDid('not-a-did')).toBeNull();
  });
});
