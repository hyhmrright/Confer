import { buildDIDDocument, type DIDDocument, resolveDID } from '@confer/identity';
import { err, ok, type Result } from '@confer/shared';
import { and, eq, type SQL } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { keypairs, users } from '../db/schema.js';
import { instanceDid, selfA2AEndpoint } from './public-identity.js';

/*
  Resolve a DID document, answering for our own identities out of our own
  database instead of over the network.

  A DID this instance minted always resolved by fetching it back from ourselves,
  which fails in the two deployments that matter:

  - `PUBLIC_HOST=localhost` (the default, and every `npx confer-cli` install).
    did:web resolution is https-only, and a single-machine stack serves plain
    http on port 80 — so `did:web:localhost:agents:<user>` resolved to
    `https://localhost/agents/<user>/did.json` and nothing was listening. Every
    inbound A2A request died at `did_resolution_failed` before its signature was
    ever checked, including one local user's agent writing to another's.
  - A real domain behind NAT, where the box often cannot reach its own public
    address (hairpin), or reaches a different front end than the one peers do.

  Answering locally is also stricter than fetching: nobody who controls DNS or
  a front end can hand us a substitute key for one of our own accounts.

  It mirrors the two documents we actually publish — `/.well-known/did.json`
  (well-known.ts) and `/agents/<username>/did.json` (agent-did.ts) — and nothing
  else. A DID under our authority that neither route would serve (an agent's
  `…:agents:<user>:agent` sub-identifier, say) is reported as not found rather
  than passed to the network, which would only fetch our own 404 back.
*/
export async function resolveDidDocument(did: string): Promise<Result<DIDDocument, string>> {
  return isOwnIdentity(did) ? resolveLocally(did) : resolveDID(did);
}

/**
 * True for this instance's own DID and any sub-identifier minted beneath it.
 *
 * The trailing `:` is what makes the prefix test safe — without it
 * `did:web:example.com.evil.net:agents:x` would pass for an instance at
 * `did:web:example.com`.
 */
export function isOwnIdentity(did: string): boolean {
  const self = instanceDid();
  return did === self || did.startsWith(`${self}:`);
}

async function resolveLocally(did: string): Promise<Result<DIDDocument, string>> {
  let key: PublishedKey | undefined;

  if (did === instanceDid()) {
    key = await activeKey(eq(keypairs.owner_type, 'instance'));
  } else {
    // Matched against the stored `users.did` exactly. Deriving a username from
    // the DID's path segments instead would let a stale or re-hosted row answer
    // under an identifier it no longer owns.
    const [user] = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.did, did))
      .limit(1);
    if (!user) return err(`No identity on this instance for ${did}`);
    key = await activeKey(and(eq(keypairs.owner_type, 'user'), eq(keypairs.owner_id, user.id)));
  }

  // A known identity with no active key is served keyless during a key-rotation
  // gap, exactly as both routes serve it: the caller then reports a missing key,
  // which is truer than a resolution failure.
  return ok(buildDIDDocument({ did, serviceEndpoint: selfA2AEndpoint(), key }));
}

interface PublishedKey {
  keyId: string;
  publicKeyMultibase: string;
}

async function activeKey(owner: SQL | undefined): Promise<PublishedKey | undefined> {
  // Only public columns — never `private_key_jwk_encrypted`.
  const [kp] = await getDb()
    .select({ key_id: keypairs.key_id, public_key_multibase: keypairs.public_key_multibase })
    .from(keypairs)
    .where(and(owner, eq(keypairs.is_active, true)))
    .limit(1);
  return kp ? { keyId: kp.key_id, publicKeyMultibase: kp.public_key_multibase } : undefined;
}
