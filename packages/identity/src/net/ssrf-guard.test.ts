import { describe, expect, test } from 'bun:test';
import { SsrfBlockedError, assertPublicHostname, isBlockedIp } from './ssrf-guard.js';

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
