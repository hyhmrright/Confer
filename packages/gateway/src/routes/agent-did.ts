import { buildDIDDocument } from '@confer/identity';
import { AppError } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { users } from '../db/schema.js';
import { publishedKeys, userKeys } from '../lib/keys.js';
import { selfA2AEndpoint } from '../lib/public-identity.js';

export const agentDidRoutes = new Hono();

/** How long a verifier may keep one of our DID documents (see lib/keys.ts). */
export const DID_DOCUMENT_CACHE = 'public, max-age=60';

// Per-user DID document. A sub-identifier DID (`did:web:<host>:agents:<username>`)
// resolves here per the did:web spec; inbound A2A signature verification fetches
// this document to find the signer's public key. Public like `.well-known` — no
// signature gate — and it only ever exposes public key material.
agentDidRoutes.get('/:username/did.json', async (c) => {
  const username = c.req.param('username');
  const db = getDb();

  const [user] = await db
    .select({ id: users.id, did: users.did })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (!user) {
    throw new AppError('user_not_found', 'User not found', 404);
  }

  // Each `verificationMethod[].id` is the STORED key_id (not rebuilt from Host):
  // inbound verification matches `vm.id === keyId` where keyId comes from the
  // request's Signature-Input, so any divergence breaks all inbound A2A auth.
  // Every live key is published — the current one and any still retiring after
  // a rotation — and an account with none is served keyless rather than 404ing
  // (same behavior as the instance document in well-known.ts).
  const doc = buildDIDDocument({
    did: user.did,
    serviceEndpoint: selfA2AEndpoint(),
    keys: await publishedKeys(userKeys(user.id)),
  });

  // Stated rather than left to each verifier's guess: a revoked key stops
  // verifying within a minute everywhere, not whenever a cache feels like it.
  c.header('cache-control', DID_DOCUMENT_CACHE);
  return c.json(doc);
});
