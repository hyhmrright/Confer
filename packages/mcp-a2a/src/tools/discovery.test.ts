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

const peerWithAlias = {
  peer_id: 'p1',
  alias: 'Aliased',
  peer: {
    did: 'did:web:a.example',
    name: 'PeerOne',
    agent_facts_json: { skills: ['code-review'] },
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
        capabilities: { skills: ['code-review'] },
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
    expect(caps).toEqual({ skills: ['code-review'] });
  });

  test('throws when the peer is not a contact', async () => {
    await expect(getAgentCapabilities(clientStub([peerWithAlias]), 'missing')).rejects.toThrow(
      /not a contact/,
    );
  });
});

describe('findAgents', () => {
  test('filters by a lowercase substring of the capabilities JSON', async () => {
    const client = clientStub([peerWithAlias, peerNoAlias]);
    // "CODE-REVIEW" must match case-insensitively against peerWithAlias only.
    const found = await findAgents(client, 'CODE-REVIEW');
    expect(found.map((a) => a.peer_id)).toEqual(['p1']);
  });

  test('returns no agents when nothing matches the capability', async () => {
    const found = await findAgents(clientStub([peerWithAlias, peerNoAlias]), 'translation');
    expect(found).toEqual([]);
  });
});
