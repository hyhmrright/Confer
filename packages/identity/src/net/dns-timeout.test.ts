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
const MISSING = 'no-such-host.test';
const SLOW_MISSING = 'slow-no-such-host.test';
const INTERNAL = 'intranet.test';
const PUBLIC = 'public.test';

// How long SLOW_MISSING takes to say it does not exist.
const SLOW_ANSWER_MS = 200;

function notFound(hostname: string): Error {
  return Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
}

mock.module('node:dns/promises', () => ({
  lookup: (hostname: string) => {
    if (hostname === STALLED) return new Promise(() => {}); // never settles
    if (hostname === MISSING) return Promise.reject(notFound(hostname));
    if (hostname === SLOW_MISSING) {
      return new Promise((_, reject) =>
        setTimeout(() => reject(notFound(hostname)), SLOW_ANSWER_MS),
      );
    }
    if (hostname === INTERNAL) return Promise.resolve([{ address: '10.0.0.5', family: 4 }]);
    if (hostname === PUBLIC) return Promise.resolve([{ address: '203.0.113.10', family: 4 }]);
    throw new Error(
      `dns-timeout.test has node:dns/promises mocked; unexpected lookup: ${hostname}`,
    );
  },
}));

const { assertNotMetadataHostname, assertPublicHostname, SsrfBlockedError, SsrfUnresolvedError } =
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
    await expect(assertNotMetadataHostname(STALLED, { dnsTimeoutMs: 25 })).rejects.toBeInstanceOf(
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

// A name on our internal network, a name that does not exist and a resolver
// that never answers are refused in the same words, but each used to take its
// own time: as long as the resolver that knows the name, as long as whoever
// says it does not exist, the whole deadline. A stopwatch read back what the
// message no longer said.
describe('refusal timing', () => {
  const DEADLINE_MS = 300;

  async function timed(run: () => Promise<unknown>): Promise<{ ms: number; refused: boolean }> {
    const started = performance.now();
    const refused = await run().then(
      () => false,
      () => true,
    );
    return { ms: performance.now() - started, refused };
  }

  test('a refused name answers at the deadline, whatever refused it and whenever', async () => {
    for (const host of [INTERNAL, MISSING, SLOW_MISSING, STALLED]) {
      const outcome = await timed(() => assertPublicHostname(host, { dnsTimeoutMs: DEADLINE_MS }));
      expect(outcome.refused).toBe(true);
      // A few milliseconds of slack under, for timer granularity.
      expect(outcome.ms).toBeGreaterThanOrEqual(DEADLINE_MS - 10);
      // And a bound over that a hold counted from the refusal rather than from
      // the start would break: SLOW_MISSING would land at 500ms, STALLED at 600.
      expect(outcome.ms).toBeLessThan(DEADLINE_MS + 100);
    }
  });

  test('an admitted name is not held', async () => {
    const outcome = await timed(() => assertPublicHostname(PUBLIC, { dnsTimeoutMs: DEADLINE_MS }));
    expect(outcome.refused).toBe(false);
    expect(outcome.ms).toBeLessThan(DEADLINE_MS / 2);
  });

  test("an owner's own runtime address is refused without the wait", async () => {
    // The owner already reaches our network through that setting; there is
    // nothing about it for a stopwatch to tell them.
    const outcome = await timed(() =>
      assertNotMetadataHostname(MISSING, { dnsTimeoutMs: DEADLINE_MS }),
    );
    expect(outcome.refused).toBe(true);
    expect(outcome.ms).toBeLessThan(DEADLINE_MS / 2);
  });
});

// Here rather than in resolver.test.ts because it needs a name that does not
// exist, and only this file answers lookups without asking a real resolver.
describe('DID resolution error text', () => {
  // It reaches an unauthenticated A2A sender as the reason its request failed,
  // so a private address and a name that does not exist must read the same —
  // otherwise it answers, for any name they try, what exists on our network.
  // The missing name is held to the guard's 5s deadline, hence the budget.
  test('a private host and a missing one are refused in the same words', async () => {
    const { resolveDID } = await import('../did/resolver.js');
    const privateHost = await resolveDID('did:web:10.0.0.5');
    const missingHost = await resolveDID(`did:web:${MISSING}`);
    expect(privateHost.ok || missingHost.ok).toBe(false);
    if (!privateHost.ok && !missingHost.ok) {
      expect(privateHost.error.replace('10.0.0.5', 'HOST')).toBe(
        missingHost.error.replace(MISSING, 'HOST'),
      );
    }
  }, 15_000);
});
