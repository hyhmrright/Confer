import { buildDIDDocument } from '@confer/identity';
import { AppError } from '@confer/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { agents, keypairs } from '../db/schema.js';
import { instanceDid, selfA2AEndpoint } from '../lib/public-identity.js';
import { wellKnownAgentCard } from './agent-card.js';

export const wellKnownRoutes = new Hono();

wellKnownRoutes.get('/did.json', async (c) => {
  // PUBLIC_HOST, not the request Host header: this document's `id` must be the
  // DID peers resolve, and behind a proxy the Host they present can be an
  // internal name. It is also what user DIDs are minted from, so deriving it
  // any other way lets the instance disagree with its own accounts.
  const did = instanceDid();
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
    serviceEndpoint: selfA2AEndpoint(),
    key: kp ? { keyId: kp.key_id, publicKeyMultibase: kp.public_key_multibase } : undefined,
  });

  return c.json(doc);
});

// The A2A standard discovery path. Answered only when this instance hosts
// exactly one public agent — see wellKnownAgentCard for why inventing one
// otherwise would be worse than a 404.
wellKnownRoutes.get('/agent-card.json', async (c) => {
  const card = await wellKnownAgentCard();
  if (!card) {
    throw new AppError(
      'not_found',
      'This instance hosts multiple agents; fetch /.well-known/agents.json and then /agents/{username}/agent-card.json',
      404,
    );
  }
  return c.json(card);
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
