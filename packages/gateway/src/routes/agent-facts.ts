import { AppError } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { agents } from '../db/schema.js';
import { getEnv } from '../env.js';

export const agentFactsRoutes = new Hono();

agentFactsRoutes.get('/agent-facts/:agentDid', async (c) => {
  const agentDid = c.req.param('agentDid');
  const db = getDb();

  const [agent] = await db.select().from(agents).where(eq(agents.did, agentDid)).limit(1);

  if (!agent) {
    throw new AppError('not_found', 'Agent not found', 404);
  }

  const host = getEnv().PUBLIC_HOST;
  const capabilities = Array.isArray(agent.capabilities_json) ? agent.capabilities_json : [];

  return c.json({
    '@context': 'https://nanda.dev/schemas/agent/v1',
    did: agent.did,
    name: agent.name ?? '',
    description: agent.description ?? '',
    capabilities,
    endpoints: {
      a2a: `https://${host}/a2a/v1`,
    },
  });
});
