import { describe, expect, mock, test } from 'bun:test';

// This file owns the only node:dns mock in the package, which is why it is its
// own file: `mock.module` replaces the module registry for the whole process,
// so the mock has to be somewhere its blast radius is obvious rather than
// buried in a suite about something else.
//
// Nothing else in @confer/identity resolves a hostname — every other guard test
// passes an IP literal, and resolver.test.ts uses one deliberately (a real DNS
// query in that suite once cost a CI run a 5000ms timeout). The default branch
// below therefore throws instead of falling back to real DNS: if some future
// test does start depending on a lookup, it should fail saying so, not quietly
// dial out.
const STALLED = 'resolver-never-answers.test';

mock.module('node:dns/promises', () => ({
  lookup: (hostname: string) => {
    if (hostname === STALLED) return new Promise(() => {}); // never settles
    throw new Error(
      `dns-timeout.test has node:dns/promises mocked; unexpected lookup: ${hostname}`,
    );
  },
}));

const { assertNotLinkLocalHostname, assertPublicHostname, SsrfBlockedError, SsrfUnresolvedError } =
  await import('./ssrf-guard.js');

describe('DNS deadline', () => {
  test('a resolver that never answers is refused, not waited on', async () => {
    const started = performance.now();
    await expect(assertPublicHostname(STALLED, { dnsTimeoutMs: 25 })).rejects.toBeInstanceOf(
      SsrfUnresolvedError,
    );
    // The point of the change: this used to be unbounded. On the inbound A2A
    // path that meant a peer's black-holed resolver held the request until
    // Bun's 255s idle timeout.
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test('the link-local guard shares the deadline', async () => {
    await expect(assertNotLinkLocalHostname(STALLED, { dnsTimeoutMs: 25 })).rejects.toBeInstanceOf(
      SsrfUnresolvedError,
    );
  });

  test('the error names the host and the deadline it missed', async () => {
    const error = await assertPublicHostname(STALLED, { dnsTimeoutMs: 25 }).catch((e) => e);
    expect(error.hostname).toBe(STALLED);
    expect(error.message).toContain('no DNS answer within 25ms');
  });

  test('an IP literal still short-circuits before the resolver is consulted', async () => {
    // If the literal path ever regressed into a lookup, the mock above would
    // throw rather than answer — so this asserts the short-circuit, not just
    // the verdict.
    await expect(assertPublicHostname('203.0.113.10')).resolves.toEqual(['203.0.113.10']);
    await expect(assertPublicHostname('169.254.169.254')).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  test('unresolved is a sibling of blocked, not a subclass', () => {
    // routes/users.ts relies on exactly this: it refuses SsrfBlockedError and
    // deliberately lets SsrfUnresolvedError fall through, because the host
    // there is one the owner typed rather than one a peer named. Collapsing
    // these into an inheritance chain would silently change that route from
    // "store it and let the dial fail" to "reject the owner's own settings".
    const unresolved = new SsrfUnresolvedError(STALLED, 25);
    expect(unresolved).not.toBeInstanceOf(SsrfBlockedError);
    expect(new SsrfBlockedError(STALLED, '10.0.0.1')).not.toBeInstanceOf(SsrfUnresolvedError);
  });
});
