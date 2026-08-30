import { describe, expect, test } from 'bun:test';
import {
  assertNotLinkLocalHostname,
  assertPublicHostname,
  isBlockedIp,
  SsrfBlockedError,
} from './ssrf-guard.js';

describe('isBlockedIp', () => {
  test('blocks IPv4 private, loopback, link-local and reserved ranges', () => {
    for (const ip of [
      '0.0.0.0',
      '10.0.0.1',
      '10.255.255.255',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '100.64.0.1',
      '100.127.255.255',
    ]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });

  test('allows public IPv4 addresses', () => {
    for (const ip of [
      '8.8.8.8',
      '1.1.1.1',
      '172.15.0.1',
      '172.32.0.1',
      '100.63.0.1',
      '93.184.216.34',
    ]) {
      expect(isBlockedIp(ip)).toBe(false);
    }
  });

  test('blocks IPv6 loopback, unspecified, link-local and unique-local', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'febf::1', 'fc00::1', 'fd12:3456::1']) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });

  test('blocks IPv4-mapped IPv6 pointing at a private address', () => {
    expect(isBlockedIp('::ffff:10.0.0.1')).toBe(true);
    expect(isBlockedIp('::ffff:169.254.169.254')).toBe(true);
    expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true);
  });

  test('allows IPv4-mapped IPv6 pointing at a public address', () => {
    expect(isBlockedIp('::ffff:8.8.8.8')).toBe(false);
  });

  test('blocks the all-hex spelling of IPv4-mapped IPv6 (WHATWG URL canonical form)', () => {
    // The URL parser canonicalizes `[::ffff:192.168.0.1]` to `::ffff:c0a8:1` —
    // must be blocked exactly like the dotted spelling.
    expect(isBlockedIp('::ffff:c0a8:1')).toBe(true); // 192.168.0.1
    expect(isBlockedIp('0:0:0:0:0:ffff:c0a8:1')).toBe(true); // fully expanded form
    expect(isBlockedIp('::ffff:a9fe:a9fe')).toBe(true); // 169.254.169.254 (cloud metadata)
    expect(isBlockedIp('::ffff:808:808')).toBe(false); // 8.8.8.8 — public, must stay allowed
  });

  test('blocks NAT64 and 6to4 addresses embedding a private IPv4', () => {
    expect(isBlockedIp('64:ff9b::c0a8:1')).toBe(true); // NAT64 well-known prefix, 192.168.0.1
    expect(isBlockedIp('2002:c0a8:1::')).toBe(true); // 6to4, 192.168.0.1
    expect(isBlockedIp('64:ff9b::808:808')).toBe(false); // NAT64, 8.8.8.8 — public
    expect(isBlockedIp('2002:808:808::')).toBe(false); // 6to4, 8.8.8.8 — public
  });

  test('blocks the deprecated IPv4-compatible IPv6 form, excluding :: and ::1', () => {
    expect(isBlockedIp('::10.0.0.1')).toBe(true); // 10.0.0.1
    expect(isBlockedIp('::808:808')).toBe(false); // 8.8.8.8 — public
  });

  test('allows a public IPv6 address', () => {
    expect(isBlockedIp('2606:4700:4700::1111')).toBe(false);
  });

  test('fails closed on non-IP input', () => {
    expect(isBlockedIp('not-an-ip')).toBe(true);
  });
});

describe('assertPublicHostname', () => {
  test('rejects a literal private IPv4 without DNS', async () => {
    await expect(assertPublicHostname('127.0.0.1')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertPublicHostname('10.0.0.5')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertPublicHostname('169.254.169.254')).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  test('rejects a literal private IPv6 without DNS', async () => {
    await expect(assertPublicHostname('::1')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertPublicHostname('::ffff:192.168.0.1')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });

  test('rejects a bracket-notation IPv6 literal (URL-serialization form)', async () => {
    // `[::1]` is how an IPv6 literal is written inside a URL authority — neither
    // node:net's isIP() nor node:dns's lookup() recognize the brackets, so an
    // unstripped bracketed private/metadata address would fail DNS resolution
    // and be silently waved through by the "resolution failure is not a block"
    // policy, while a caller's fetch() connects to it directly (no DNS needed
    // for a literal). Metadata address in its IPv4-mapped-IPv6 bracketed form:
    await expect(assertPublicHostname('[::ffff:169.254.169.254]')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    await expect(assertPublicHostname('[::1]')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertPublicHostname('[fe80::1]')).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  test('fails closed on malformed bracket notation instead of falling through to DNS', async () => {
    // Bracket notation is reserved for IP literals (RFC 3986) — a bracketed
    // value that isn't a valid IP is malformed, not a hostname to look up.
    await expect(assertPublicHostname('[]')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertPublicHostname('[not-an-ip]')).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  test('allowLoopback permits a bracketed ::1 literal too', async () => {
    await expect(assertPublicHostname('[::1]', { allowLoopback: true })).resolves.toEqual(['::1']);
    // A bracketed non-loopback private address stays blocked.
    await expect(
      assertPublicHostname('[::ffff:169.254.169.254]', { allowLoopback: true }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  test('returns the address for a literal public IP without DNS', async () => {
    await expect(assertPublicHostname('8.8.8.8')).resolves.toEqual(['8.8.8.8']);
  });

  test('rejects a hostname that resolves to loopback (localhost)', async () => {
    // `localhost` resolves via the hosts file (no network) to ::1 / 127.0.0.1.
    await expect(assertPublicHostname('localhost')).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  test('allowLoopback permits loopback but still blocks other private ranges', async () => {
    // Loopback is admitted (a single-machine did:web:localhost deployment).
    await expect(assertPublicHostname('127.0.0.1', { allowLoopback: true })).resolves.toEqual([
      '127.0.0.1',
    ]);
    await expect(assertPublicHostname('::1', { allowLoopback: true })).resolves.toEqual(['::1']);
    // LAN and metadata ranges remain blocked even with allowLoopback.
    await expect(assertPublicHostname('10.0.0.1', { allowLoopback: true })).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    await expect(
      assertPublicHostname('169.254.169.254', { allowLoopback: true }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

// The inverse policy, for addresses the owner deliberately chose: a local LLM
// runtime lives on loopback, on the Docker host, or on the LAN, so those must
// stay reachable. Only the metadata range is refused.
describe('assertNotLinkLocalHostname', () => {
  test('rejects the cloud metadata address in every form it can be written', async () => {
    for (const host of [
      '169.254.169.254',
      '169.254.0.1', // anywhere in the /16, not just the well-known host
      '::ffff:169.254.169.254', // IPv4-mapped
      '[::ffff:169.254.169.254]', // …and its URL-authority spelling
      '2002:a9fe:a9fe::', // 6to4-encoded 169.254.169.254
      'fe80::1', // IPv6 link-local
      'fd00:ec2::254', // AWS IMDS over IPv6
    ]) {
      await expect(assertNotLinkLocalHostname(host)).rejects.toBeInstanceOf(SsrfBlockedError);
    }
  });

  test('admits the private addresses a local runtime actually uses', async () => {
    // Each of these is documented somewhere as the way to reach Ollama; a guard
    // that blocked them would be blocking the feature, not an attack.
    for (const host of ['127.0.0.1', '::1', '192.168.1.50', '172.17.0.1', '10.0.0.5', '8.8.8.8']) {
      await expect(assertNotLinkLocalHostname(host)).resolves.toContain(host);
    }
    await expect(assertNotLinkLocalHostname('localhost')).resolves.not.toHaveLength(0);
  });

  test('fails closed on malformed bracket notation, like its sibling', async () => {
    await expect(assertNotLinkLocalHostname('[]')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertNotLinkLocalHostname('[not-an-ip]')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });

  // `http://2852039166/` reaches the same host as `http://169.254.169.254/`,
  // and neither `isIP` nor this module's own parser recognises those spellings
  // — getaddrinfo does, and normalises them. They are caught only because the
  // guard resolves the name rather than pattern-matching it, which is the
  // property worth pinning: a future "fast path" that skipped the lookup for
  // hostnames that don't look like IPs would reopen exactly this.
  test('rejects the numeric and octal spellings of the metadata address', async () => {
    for (const host of ['2852039166', '0251.0376.0251.0376']) {
      await expect(assertNotLinkLocalHostname(host)).rejects.toBeInstanceOf(SsrfBlockedError);
    }
  });
});
