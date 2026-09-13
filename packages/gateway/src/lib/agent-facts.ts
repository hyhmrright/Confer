import { type AgentFacts, agentFactsSchema } from '@confer/identity';
import { z } from 'zod';

// What Confer keeps of AgentFacts. The NANDA schema bounds no string and no
// list, while remote directories and old rows feed this and the MCP discovery
// tool hands the result to Claude Code — so every field is capped here.
const capabilitySchema = z.object({
  type: z.string().min(1).max(64),
  scope: z.array(z.string().max(200)).max(50),
  languages: z.array(z.string().max(35)).max(10),
});
const boundedFactsSchema = agentFactsSchema.extend({
  name: z.string().max(128),
  description: z.string().max(4000).optional(),
  capabilities: z.array(capabilitySchema).max(64),
});

export type AgentCapability = z.infer<typeof capabilitySchema>;

/** The fields AgentFacts are built from: an `agents` row, or a remote directory entry. */
export interface AgentFactsSource {
  did: string;
  name?: string | null;
  description?: string | null;
  capabilities_json?: unknown;
}

/**
 * The entries of a `capabilities_json` value that are NANDA capabilities
 * (`{type, scope, languages}`) within the caps above.
 *
 * That column is what the owner saved through `PATCH /agents/me`, which checks
 * only that each entry is an object, so the rest are left out rather than
 * failing whatever is built from it.
 */
export function declaredCapabilities(value: unknown): AgentCapability[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = capabilitySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * An agent's AgentFacts in the NANDA shape (docs/03-protocol.md), parsed before
 * anything publishes or stores it — Contract 3.
 *
 * Nothing is filled in, a language in particular: `agents.primary_language`
 * defaults to `zh` and nothing sets it, so publishing it would announce that
 * every agent speaks Chinese.
 *
 * Both directions go through this: the route that publishes ours, and contact
 * discovery, which used to store whatever a remote directory entry or DID
 * document happened to contain under this name.
 */
export function buildAgentFacts(source: AgentFactsSource, endpoint: string): AgentFacts {
  return boundedFactsSchema.parse({
    did: source.did,
    name: source.name ?? '',
    description: source.description ?? undefined,
    capabilities: declaredCapabilities(source.capabilities_json),
    endpoints: { a2a: endpoint },
  });
}

/**
 * A peer row as the API hands it out. Rows written before discovery built
 * AgentFacts hold a raw directory entry or a whole DID document in this column,
 * and the MCP discovery tool gives it to Claude Code as the peer's
 * capabilities — so anything that is not bounded, valid AgentFacts reads as
 * none. The parsed value is returned, not the stored one: the schema passes a
 * document with extra keys, and only its output drops them.
 */
export function withValidAgentFacts<T extends { agent_facts_json: unknown }>(peer: T): T {
  const parsed = boundedFactsSchema.safeParse(peer.agent_facts_json);
  return { ...peer, agent_facts_json: parsed.success ? parsed.data : {} };
}
