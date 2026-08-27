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
