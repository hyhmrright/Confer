import { getEnv } from '../env.js';
import { toDidAuthority, toSelfOrigin } from './public-host.js';

// Everything this instance publishes about itself — its DID, the DIDs it mints
// for its users, and the A2A endpoint it advertises — derives from PUBLIC_HOST
// and nothing else. Before this module each caller built its own string and
// they disagreed: registration hardcoded `localhost`, well-known and the
// per-user DID document read the request Host header, AgentFacts read
// PUBLIC_HOST but always said `https`.

/** This instance's own DID. */
export function instanceDid(): string {
  return `did:web:${toDidAuthority(getEnv().PUBLIC_HOST)}`;
}

/** The DID minted for a user registered on this instance. */
export function userDid(username: string): string {
  return `${instanceDid()}:agents:${username}`;
}

/** The A2A endpoint this instance advertises to peers. */
export function selfA2AEndpoint(): string {
  return `${toSelfOrigin(getEnv().PUBLIC_HOST)}/a2a/v1`;
}

/** This instance's public origin, as peers reach it. */
export function selfOrigin(): string {
  return toSelfOrigin(getEnv().PUBLIC_HOST);
}

/**
 * Where to actually dial an advertised A2A endpoint from inside this process.
 *
 * Every identity on this instance advertises `selfA2AEndpoint()`, which is the
 * address a *peer* should use. Dialling it ourselves does not work and the
 * reason is not obvious: the advertised origin names the public entrance —
 * `http://localhost` is nginx on port 80, in a different container — while
 * inside the gateway `localhost` is the gateway, which listens on PORT and
 * serves nothing on 80. Every same-instance consult therefore died with
 * "Unable to connect", including two accounts on one machine talking to each
 * other, which is the shape most people try first.
 *
 * Rewriting the origin rather than delivering in-process is deliberate: the
 * message still goes out as a real signed request and comes back through the
 * same signature verification and admission middleware, so there is no second
 * delivery path that could drift from the one peers use.
 */
export function dialableEndpoint(endpoint: string): string {
  const self = selfA2AEndpoint();
  // Matched on a path boundary. A host that merely begins the way ours does is
  // somebody else's, and this rewrite points at a loopback port, so being loose
  // here would let a peer's advertised endpoint be redirected into this process.
  if (endpoint !== self && !endpoint.startsWith(`${self}/`)) return endpoint;

  const env = getEnv();
  // HOST is what the server BINDS to; the wildcards are not addresses you can
  // connect to. An IPv6 literal needs brackets to survive inside a URL.
  const bound = env.HOST === '0.0.0.0' || env.HOST === '::' ? '127.0.0.1' : env.HOST;
  const host = bound.includes(':') ? `[${bound}]` : bound;
  const path = endpoint.slice(toSelfOrigin(env.PUBLIC_HOST).length);
  return `http://${host}:${env.PORT}${path}`;
}
