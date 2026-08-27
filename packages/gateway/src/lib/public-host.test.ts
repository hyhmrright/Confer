import { describe, expect, test } from 'bun:test';
import { toDidAuthority, toSelfOrigin } from './public-host.js';

describe('toDidAuthority', () => {
  // did:web splits the method-specific id on `:`, so an unencoded port would be
  // read as a path segment and the document would be fetched from the wrong URL.
  test('percent-encodes the port', () => {
    expect(toDidAuthority('localhost:3000')).toBe('localhost%3A3000');
    expect(toDidAuthority('confer.example.com:8443')).toBe('confer.example.com%3A8443');
  });

  test('leaves a portless host alone', () => {
    expect(toDidAuthority('confer.example.com')).toBe('confer.example.com');
  });

  // An IPv6 literal has colons on both sides of the one that separates the
  // port, so anything that splits on the first `:` mangles the address itself.
  test('encodes only the port separator of an IPv6 literal', () => {
    expect(toDidAuthority('[::1]:3000')).toBe('[::1]%3A3000');
    expect(toDidAuthority('[::1]')).toBe('[::1]');
  });

  // PUBLIC_HOST is hand-written, so tolerate the shapes an operator will paste.
  test('normalizes a pasted URL down to host[:port]', () => {
    expect(toDidAuthority(' https://Confer.Example.com/ ')).toBe('confer.example.com');
    expect(toDidAuthority('http://localhost:3000/a2a/v1')).toBe('localhost%3A3000');
  });
});

describe('toSelfOrigin', () => {
  // A single-machine install has no certificate, so advertising https there
  // would hand peers an endpoint that cannot be dialed.
  test('uses http for loopback hosts', () => {
    expect(toSelfOrigin('localhost')).toBe('http://localhost');
    expect(toSelfOrigin('localhost:3000')).toBe('http://localhost:3000');
    expect(toSelfOrigin('127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
  });

  test('uses https everywhere else', () => {
    expect(toSelfOrigin('confer.example.com')).toBe('https://confer.example.com');
    // A host that merely starts with the loopback name is not loopback.
    expect(toSelfOrigin('localhost.example.com')).toBe('https://localhost.example.com');
  });
});
