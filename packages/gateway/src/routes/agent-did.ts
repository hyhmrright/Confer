import { buildDIDDocument } from '@confer/identity';
import { AppError } from '@confer/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { keypairs, users } from '../db/schema.js';
import { selfA2AEndpoint } from '../lib/public-identity.js';

export const agentDidRoutes = new Hono();

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

  // Only public columns — never `private_key_jwk_encrypted`.
  const [kp] = await db
    .select({
      key_id: keypairs.key_id,
      public_key_multibase: keypairs.public_key_multibase,
    })
    .from(keypairs)
    .where(
      and(
        eq(keypairs.owner_type, 'user'),
        eq(keypairs.owner_id, user.id),
        eq(keypairs.is_active, true),
      ),
    )
    .limit(1);

  // `verificationMethod[0].id` must be the STORED key_id (not rebuilt from Host):
  // inbound verification matches `vm.id === keyId` where keyId comes from the
  // request's Signature-Input, so any divergence breaks all inbound A2A auth.
  // Serve a keyless document during a key-rotation gap rather than 404ing (same
  // behavior as the instance document in well-known.ts).
  const doc = buildDIDDocument({
    did: user.did,
    serviceEndpoint: selfA2AEndpoint(),
    key: kp ? { keyId: kp.key_id, publicKeyMultibase: kp.public_key_multibase } : undefined,
  });

  return c.json(doc);
});
