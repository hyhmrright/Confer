import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { agents, keypairs } from '../db/schema.js';

export const wellKnownRoutes = new Hono();

wellKnownRoutes.get('/did.json', async (c) => {
  const host = c.req.header('host') ?? 'localhost';
  const did = `did:web:${host}`;
  const db = getDb();

  const [kp] = await db
    .select()
    .from(keypairs)
    .where(and(eq(keypairs.owner_type, 'instance'), eq(keypairs.is_active, true)))
    .limit(1);

  const verificationMethods = kp
    ? [
        {
          id: kp.key_id,
          type: 'Ed25519VerificationKey2020',
          controller: did,
          publicKeyMultibase: kp.public_key_multibase,
        },
      ]
    : [];

  return c.json({
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: did,
    verificationMethod: verificationMethods,
    service: [
      {
        id: `${did}#confer-agent`,
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
