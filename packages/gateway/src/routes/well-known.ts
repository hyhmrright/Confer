import { buildDIDDocument } from '@confer/identity';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { agents, keypairs } from '../db/schema.js';

export const wellKnownRoutes = new Hono();

wellKnownRoutes.get('/did.json', async (c) => {
  const host = c.req.header('host') ?? 'localhost';
  const did = `did:web:${host}`;
  const db = getDb();

  // Only public columns — never `private_key_jwk_encrypted`.
  const [kp] = await db
    .select({
      key_id: keypairs.key_id,
      public_key_multibase: keypairs.public_key_multibase,
    })
    .from(keypairs)
    .where(and(eq(keypairs.owner_type, 'instance'), eq(keypairs.is_active, true)))
    .limit(1);

  // Shared builder keeps the instance and per-user DID documents in one shape;
  // with no active instance key the document is served keyless
  // (`verificationMethod: []`, `authentication: []`) rather than 404ing.
  const doc = buildDIDDocument({
    did,
    serviceEndpoint: `https://${host}/a2a/v1`,
    key: kp ? { keyId: kp.key_id, publicKeyMultibase: kp.public_key_multibase } : undefined,
  });

  return c.json(doc);
});

wellKnownRoutes.get('/agents.json', async (c) => {
  const db = getDb();

  const publicAgents = await db
    .select({
      did: agents.did,
      name: agents.name,
      description: agents.description,
      primary_language: agents.primary_language,
      capabilities_json: agents.capabilities_json,
      is_public: agents.is_public,
    })
    .from(agents)
    // Suspended agents (moderation 3b) are filtered from the public discovery
    // list. This only drops the row from the listing — it does not modify any
    // agent's AgentFacts/DID document (Contract 3 stays untouched).
    .where(and(eq(agents.is_public, true), eq(agents.status, 'active')));

  return c.json({ agents: publicAgents });
});
