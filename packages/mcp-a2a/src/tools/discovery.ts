import type { GatewayClient } from '../gateway-client.js';

export interface AgentSummary {
  peer_id: string;
  did: string;
  name: string | null;
  capabilities: unknown;
}

// Shape of GET /api/v1/contacts: each row is a peer_contact spread flat with the
// joined peer agent nested under `peer`.
interface ContactsResponse {
  contacts: Array<{
    peer_id: string;
    alias?: string | null;
    peer: {
      did: string;
      name?: string | null;
      agent_facts_json?: unknown;
    };
  }>;
}

export async function listAgents(client: GatewayClient): Promise<AgentSummary[]> {
  const { contacts } = await client.get<ContactsResponse>('/api/v1/contacts');
  return contacts.map((c) => ({
    peer_id: c.peer_id,
    did: c.peer.did,
    name: c.alias ?? c.peer.name ?? null,
    capabilities: c.peer.agent_facts_json ?? null,
  }));
}

export async function getAgentCapabilities(
  client: GatewayClient,
  peerId: string,
): Promise<unknown> {
  const agents = await listAgents(client);
  const found = agents.find((a) => a.peer_id === peerId);
  if (!found) throw new Error(`peer ${peerId} is not a contact`);
  return found.capabilities;
}

export async function findAgents(
  client: GatewayClient,
  capability: string,
): Promise<AgentSummary[]> {
  const needle = capability.toLowerCase();
  const agents = await listAgents(client);
  return agents.filter((a) => describedAs(a.capabilities).includes(needle));
}

// What a peer's AgentFacts say about it, lowercased for matching: its name,
// description, and each capability's type and scope. Values only — the rest of
// the document is a schema URL and an A2A endpoint every peer shares, and key
// names such as "scope" sit in every capability, so matching the raw JSON found
// everyone.
function describedAs(facts: unknown): string {
  const { name, description, capabilities } = (facts ?? {}) as {
    name?: unknown;
    description?: unknown;
    capabilities?: unknown;
  };
  const words: unknown[] = [name, description];
  for (const capability of Array.isArray(capabilities) ? capabilities : []) {
    const { type, scope } = (capability ?? {}) as { type?: unknown; scope?: unknown };
    words.push(type, ...(Array.isArray(scope) ? scope : []));
  }
  return words
    .filter((word): word is string => typeof word === 'string')
    .join('\n')
    .toLowerCase();
}
