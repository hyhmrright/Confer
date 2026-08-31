import { describe, expect, test } from 'bun:test';
import { type AgentCardInput, buildAgentCard } from './agent-card.js';

const base: AgentCardInput = {
  agent: {
    did: 'did:web:example.com:agents:alice',
    name: 'Alice Bot',
    description: '负责回答产品问题',
    capabilities_json: [],
  },
  username: 'alice',
  a2aEndpoint: 'https://example.com/a2a/v1',
  instanceUrl: 'https://example.com',
};

const build = (over: Partial<AgentCardInput['agent']> = {}) =>
  buildAgentCard({ ...base, agent: { ...base.agent, ...over } });

describe('buildAgentCard', () => {
  test('carries every field the spec marks REQUIRED', () => {
    const card = build();
    // From specification/a2a.proto @ v1.0.1. A Card missing one of these is not
    // a Card a conformant client is obliged to accept.
    for (const field of [
      'name',
      'description',
      'supportedInterfaces',
      'version',
      'capabilities',
      'defaultInputModes',
      'defaultOutputModes',
      'skills',
    ] as const) {
      expect(card[field]).toBeDefined();
    }
    expect(card.supportedInterfaces.length).toBeGreaterThan(0);
    // `skills` is REQUIRED and a Card advertising none describes an agent that
    // does nothing.
    expect(card.skills.length).toBeGreaterThan(0);
  });

  test('declares the interface as HTTP+JSON at protocol version 1.0', () => {
    const iface = build().supportedInterfaces[0];
    expect(iface?.protocolBinding).toBe('HTTP+JSON');
    expect(iface?.protocolVersion).toBe('1.0');
    expect(iface?.url).toBe('https://example.com/a2a/v1');
  });

  test('routes to the agent by tenant, since one endpoint serves many', () => {
    // The spec's mechanism for several agents behind a single A2A endpoint,
    // which is exactly this deployment. Without it every agent on the instance
    // would advertise an identical, unusable interface.
    expect(build().supportedInterfaces[0]?.tenant).toBe('alice');
  });

  test('declares the signature requirement as a REQUIRED extension', () => {
    const extension = build().capabilities.extensions[0];
    expect(extension?.uri).toContain('rfc9421');
    // Load-bearing: a client that skips this cannot talk to the agent at all,
    // so `required: false` would advertise interoperability that is not there.
    expect(extension?.required).toBe(true);
  });

  test('does not claim streaming it cannot deliver in the spec shape', () => {
    // There IS a streaming endpoint, but it is Confer's own shape rather than
    // SendStreamingMessage. Advertising it would fail on first use.
    expect(build().capabilities.streaming).toBe(false);
  });

  test('advertises no securityScheme, because it accepts none of them', () => {
    // The spec's schemes are API key / HTTP auth / OAuth2 / OIDC / mTLS. This
    // endpoint takes a request signature and nothing else, so naming one would
    // tell a client to authenticate in a way that gets rejected.
    expect(build()).not.toHaveProperty('securitySchemes');
  });

  test('maps declared capabilities to skills one for one', () => {
    const card = build({ capabilities_json: ['产品咨询', 'code review'] });
    expect(card.skills).toHaveLength(2);
    expect(card.skills.map((s) => s.name)).toEqual(['产品咨询', 'code review']);
    expect(card.skills[1]?.id).toBe('code-review');
  });

  test('gives Chinese capabilities distinct ids rather than colliding on empty', () => {
    // Slugifying Chinese leaves nothing, and two skills sharing an id is a
    // malformed Card.
    const card = build({ capabilities_json: ['产品咨询', '技术支持'] });
    const ids = card.skills.map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => id.length > 0)).toBe(true);
  });

  test('falls back to one true skill when the owner declared none', () => {
    expect(build({ capabilities_json: [] }).skills).toHaveLength(1);
    expect(build({ capabilities_json: null }).skills).toHaveLength(1);
  });

  test('ignores non-string entries in a free-form capabilities list', () => {
    // capabilities_json is jsonb and nothing constrains its contents.
    const card = build({ capabilities_json: ['ok', 42, null, { a: 1 }] });
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0]?.name).toBe('ok');
  });

  test('never emits an empty required string when the agent has no name or description', () => {
    const card = build({ name: null, description: null });
    expect(card.name).toBe('alice');
    expect(card.description.length).toBeGreaterThan(0);
  });
});
