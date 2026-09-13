import { expect, test } from 'bun:test';
import { assertPublicHostname, SsrfBlockedError } from '@confer/identity';

// `setup.ts` replaces node:dns/promises for the whole gateway process, and the
// one thing that reads it is the SSRF guard inside @confer/identity — a
// different package, reached through a workspace symlink. This pins that the
// stub actually arrives there. A preload that quietly stopped applying would
// hand every signed test back to the OS resolver, and nothing would say so
// until a slow answer cost a CI run its 5s (issue #75).

test('a fixture host resolves in-process, to TEST-NET', async () => {
  await expect(assertPublicHostname('peer.example')).resolves.toEqual(['203.0.113.10']);
});

test('localhost still resolves to loopback, so the guard can refuse it', async () => {
  // A short deadline, because a refused name is held until it.
  await expect(assertPublicHostname('localhost', { dnsTimeoutMs: 50 })).rejects.toBeInstanceOf(
    SsrfBlockedError,
  );
});
