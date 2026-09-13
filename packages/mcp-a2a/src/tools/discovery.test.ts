import { describe, expect, test } from 'bun:test';
import type { GatewayClient } from '../gateway-client.js';
import { findAgents, getAgentCapabilities, listAgents } from './discovery.js';

// Stub only the GatewayClient.get used by discovery; one canned contacts payload.
function clientStub(contacts: unknown[]): GatewayClient {
  return {
    get: async () => ({ contacts }),
    whoami: () => 'u',
  } as unknown as GatewayClient;
}

// The AgentFacts a gateway stores for a discovered peer.
const facts = {
  '@context': 'https://nanda.dev/schemas/agent/v1',
  did: 'did:web:a.example',
  name: 'PeerOne',
  description: 'Rust and Go services',
  capabilities: [{ type: 'code-review', scope: ['typescript'], languages: ['en'] }],
  endpoints: { a2a: 'https://a.example/a2a/v1' },
};
const peerWithAlias = {
  peer_id: 'p1',
  alias: 'Aliased',
  peer: {
    did: 'did:web:a.example',
    name: 'PeerOne',
    agent_facts_json: facts,
  },
};
const peerNoAlias = {
  peer_id: 'p2',
  alias: null,
  peer: { did: 'did:web:b.example', name: 'PeerTwo', agent_facts_json: null },
};

describe('listAgents', () => {
  test('maps each contact to an agent summary', async () => {
    const agents = await listAgents(clientStub([peerWithAlias]));
    expect(agents).toEqual([
      {
        peer_id: 'p1',
        did: 'did:web:a.example',
        name: 'Aliased',
        capabilities: facts,
      },
    ]);
  });

  test('falls back to peer.name when alias is null', async () => {
    const agents = await listAgents(clientStub([peerNoAlias]));
    expect(agents[0]?.name).toBe('PeerTwo');
  });

  test('maps null agent_facts_json to null capabilities', async () => {
    const agents = await listAgents(clientStub([peerNoAlias]));
    expect(agents[0]?.capabilities).toBeNull();
  });
});

describe('getAgentCapabilities', () => {
  test('returns the matching peer capabilities', async () => {
    const caps = await getAgentCapabilities(clientStub([peerWithAlias]), 'p1');
    expect(caps).toEqual(facts);
  });

  test('throws when the peer is not a contact', async () => {
    await expect(getAgentCapabilities(clientStub([peerWithAlias]), 'missing')).rejects.toThrow(
      /not a contact/,
    );
  });
});

describe('findAgents', () => {
  test('filters by a lowercase substring of the declared capabilities', async () => {
    const client = clientStub([peerWithAlias, peerNoAlias]);
    // "TYPESCRIPT" must match case-insensitively against peerWithAlias only.
    const found = await findAgents(client, 'TYPESCRIPT');
    expect(found.map((a) => a.peer_id)).toEqual(['p1']);
  });

  // Few owners declare capabilities, so the description is often all there is.
  test('matches a peer by what its description says', async () => {
    const found = await findAgents(clientStub([peerWithAlias, peerNoAlias]), 'rust');
    expect(found.map((a) => a.peer_id)).toEqual(['p1']);
  });

  // Every peer's AgentFacts carry the schema URL, an /a2a/v1 endpoint and the
  // same key names, so a match against the raw document returned everyone.
  test('does not match what every AgentFacts document contains', async () => {
    const client = clientStub([peerWithAlias, peerNoAlias]);
    for (const shared of ['a2a', 'https', 'nanda', 'scope', 'languages']) {
      expect(await findAgents(client, shared)).toEqual([]);
    }
  });

  test('returns no agents when nothing matches the capability', async () => {
    const found = await findAgents(clientStub([peerWithAlias, peerNoAlias]), 'translation');
    expect(found).toEqual([]);
  });
});
