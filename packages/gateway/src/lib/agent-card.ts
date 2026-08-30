/**
 * A2A Agent Card (Linux Foundation Agent2Agent, protocol version 1.0).
 *
 * Confer implements its own A2A dialect — REST over `/a2a/v1/messages`, with
 * did:web identity and RFC 9421 HTTP Message Signatures. That predates the
 * standard reaching 1.0, and the names collided: the spec's discovery document
 * lives at `/.well-known/agent-card.json` while this instance publishes
 * `/.well-known/agents.json`, so an agent on either side could not find one on
 * the other. This module closes the discovery half of that gap by publishing a
 * conformant Card describing what is genuinely here.
 *
 * The shape is taken from `specification/a2a.proto` in a2aproject/A2A at
 * v1.0.1, serialized with the proto3 JSON mapping — which is why the fields are
 * camelCase (`supportedInterfaces`) while the proto declares snake_case.
 *
 * Two things are deliberately NOT claimed:
 *
 *   - `streaming: false`. There is a streaming endpoint, but it is Confer's own
 *     shape, not the spec's `SendStreamingMessage`. Advertising a capability a
 *     standard client cannot actually use is worse than not advertising it.
 *   - No `securitySchemes`. The spec's set is API key / HTTP auth / OAuth2 /
 *     OIDC / mTLS, and this endpoint accepts none of them — it requires a
 *     request signature. Claiming one of those would tell a client it can
 *     authenticate in a way that will in fact be rejected. The real requirement
 *     is stated as a *required extension* instead, which is the mechanism the
 *     spec provides for exactly this.
 */

/** The protocol version this Card describes. */
const A2A_PROTOCOL_VERSION = '1.0';

/**
 * Identifier for the signature requirement, declared as a required extension.
 *
 * The RFC's own URL is used as the identifier because there is no registry for
 * these and a self-describing URI beats an invented namespace: a developer who
 * has never seen Confer can paste it into a browser and learn what is being
 * asked of them.
 */
const SIGNATURE_EXTENSION_URI = 'https://www.rfc-editor.org/rfc/rfc9421';

export interface AgentCardInput {
  /** The agent's own row. */
  agent: {
    did: string;
    name: string | null;
    description: string | null;
    capabilities_json: unknown;
  };
  /** Owner's username — the tenant selector for this agent behind the shared endpoint. */
  username: string;
  /** Absolute base URL of the A2A interface, e.g. `https://host/a2a/v1`. */
  a2aEndpoint: string;
  /** Absolute base URL of the instance, used as the provider URL. */
  instanceUrl: string;
}

export interface AgentCard {
  name: string;
  description: string;
  version: string;
  supportedInterfaces: Array<{
    url: string;
    protocolBinding: string;
    protocolVersion: string;
    tenant?: string;
  }>;
  provider: { url: string; organization: string };
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    extensions: Array<{
      uri: string;
      description: string;
      required: boolean;
      params?: Record<string, unknown>;
    }>;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
  }>;
}

/**
 * Build the Card for one agent.
 *
 * `tenant` is what makes a multi-user instance expressible at all: the spec
 * defines it as an opaque routing selector for when several agents sit behind
 * one A2A endpoint, which is exactly this deployment. Clients that honour it
 * send it back on every request; the username is used because it is already the
 * stable, public part of the agent's DID.
 */
export function buildAgentCard(input: AgentCardInput): AgentCard {
  const { agent, username, a2aEndpoint, instanceUrl } = input;
  const name = agent.name?.trim() || username;

  return {
    name,
    // Required by the spec, so it always carries something true rather than an
    // empty string when the owner never wrote one.
    description: agent.description?.trim() || `${username} 的 Agent，代其主人回答问题。`,
    version: '1.0.0',
    supportedInterfaces: [
      {
        url: a2aEndpoint,
        // One of the three officially supported bindings. Confer speaks REST,
        // not JSON-RPC or gRPC.
        protocolBinding: 'HTTP+JSON',
        protocolVersion: A2A_PROTOCOL_VERSION,
        tenant: username,
      },
    ],
    provider: { url: instanceUrl, organization: 'Confer' },
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [
        {
          uri: SIGNATURE_EXTENSION_URI,
          description:
            'Every request must carry an RFC 9421 HTTP Message Signature. The signing key is published in the sender agent DID document (did:web), which the receiver resolves to verify. Requests without a valid signature are rejected.',
          // `required: true` is the honest value and the load-bearing one: a
          // client that ignores this extension cannot talk to this agent at
          // all, so presenting it as optional would promise interoperability
          // that does not exist.
          required: true,
          params: {
            signatureAlgorithm: 'ed25519',
            keyDiscovery: 'did:web',
            senderDidDocument: '/.well-known/did.json or /agents/{username}/did.json',
          },
        },
      ],
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: buildSkills(agent.capabilities_json, name),
  };
}

/**
 * Map the agent's declared capabilities onto AgentSkill entries.
 *
 * `capabilities_json` is a free-form list of strings (the NANDA AgentFacts
 * shape). Skills require id, name, description and tags, so each capability
 * becomes one skill with the string carried through rather than embellished —
 * inventing descriptions the owner never wrote would put words in their agent's
 * mouth for anyone browsing the directory.
 *
 * Skills are required and must be non-empty, so an agent that declared no
 * capabilities gets the one skill that is true of every agent here.
 */
function buildSkills(capabilities: unknown, agentName: string): AgentCard['skills'] {
  const list = Array.isArray(capabilities)
    ? capabilities.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];

  if (list.length === 0) {
    return [
      {
        id: 'ask',
        name: '代答',
        description: `向 ${agentName} 提问，由其代主人回答。`,
        tags: ['conversation'],
      },
    ];
  }

  return list.map((capability, index) => ({
    id: slugify(capability, index),
    name: capability,
    description: capability,
    tags: ['capability'],
  }));
}

/**
 * A stable, URL-safe skill id.
 *
 * Capabilities are free text and frequently Chinese, which slugifies to
 * nothing — hence the index fallback, so two capabilities can never collapse
 * onto the same id.
 */
function slugify(value: string, index: number): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `skill-${index + 1}`;
}
