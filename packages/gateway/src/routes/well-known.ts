import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { agents } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export const wellKnownRoutes = new Hono();

wellKnownRoutes.get('/did.json', async (c) => {
  const host = c.req.header('host') ?? 'localhost';

  return c.json({
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: `did:web:${host}`,
    verificationMethod: [
      {
        id: `did:web:${host}#key-1`,
        type: 'Ed25519VerificationKey2020',
        controller: `did:web:${host}`,
        // TODO: generate real keypair on first boot
        publicKeyMultibase: 'z6MkpTHR8VNsBxYAAWHut2Geadd9jSwPlaceholder',
      },
    ],
    service: [
      {
        id: `did:web:${host}#confer-agent`,
        type: 'ConferAgent',
        serviceEndpoint: `https://${host}/a2a/v1`,
      },
    ],
  });
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
    .where(eq(agents.is_public, true));

  return c.json({ agents: publicAgents });
});
