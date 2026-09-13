import { AppError } from '@confer/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { agents } from '../db/schema.js';
import { buildAgentFacts } from '../lib/agent-facts.js';
import { selfA2AEndpoint } from '../lib/public-identity.js';

export const agentFactsRoutes = new Hono();

agentFactsRoutes.get('/agent-facts/:agentDid', async (c) => {
  const agentDid = c.req.param('agentDid');
  const db = getDb();

  // Only the agents the public directory lists. The Agent Card 404s a private
  // or suspended agent so its existence cannot be probed; this answered for
  // both, name and description included.
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.did, agentDid), eq(agents.is_public, true), eq(agents.status, 'active')))
    .limit(1);

  if (!agent) {
    throw new AppError('not_found', 'Agent not found', 404);
  }

  return c.json(buildAgentFacts(agent, selfA2AEndpoint()));
});
