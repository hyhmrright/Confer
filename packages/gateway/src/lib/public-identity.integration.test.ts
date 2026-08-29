import { describe, expect, test } from 'bun:test';
import { getEnv } from '../env.js';
import { dialableEndpoint, selfA2AEndpoint } from './public-identity.js';

/*
  These read the real env rather than mocking it — anything touching getEnv()
  poisons the process for the integration suite (see CLAUDE.md).

  What they cover: every account on an instance advertises the same A2A
  endpoint, so two users on one machine talking to each other means the gateway
  dialling its own advertised address. That address is the public entrance —
  `http://localhost` is nginx, in another container — while inside the gateway
  `localhost` is the gateway itself, listening on PORT and serving nothing on
  80. Every same-instance consult failed with "Unable to connect. Is the
  computer able to access the url?", which is the first thing most people try.
*/

describe('dialableEndpoint', () => {
  test('rewrites our own advertised endpoint to the address we listen on', () => {
    const env = getEnv();
    const dialled = dialableEndpoint(`${selfA2AEndpoint()}/messages`);

    expect(dialled).toBe(`http://127.0.0.1:${env.PORT}/a2a/v1/messages`);
  });

  test('leaves the bare advertised endpoint dialable too', () => {
    expect(dialableEndpoint(selfA2AEndpoint())).toBe(`http://127.0.0.1:${getEnv().PORT}/a2a/v1`);
  });

  test('leaves a peer on another host alone', () => {
    const foreign = 'https://peer.example/a2a/v1/messages';
    expect(dialableEndpoint(foreign)).toBe(foreign);
  });

  // A host that merely starts the way ours does is somebody else's, and must
  // still be dialled as written — the rewrite sends traffic to a loopback port
  // with no signature check of its own, so matching too eagerly would let a
  // peer's advertised endpoint be redirected into this process.
  test('does not match a host that only shares our prefix', () => {
    const { hostname } = new URL(selfA2AEndpoint());
    const lookalike = `http://${hostname}.evil.example/a2a/v1/messages`;
    expect(dialableEndpoint(lookalike)).toBe(lookalike);
  });

  // A longer path under our endpoint is ours; a sibling that merely shares the
  // prefix as text is not.
  test('separates on a path boundary', () => {
    expect(dialableEndpoint(`${selfA2AEndpoint()}x/messages`)).toBe(
      `${selfA2AEndpoint()}x/messages`,
    );
  });
});
