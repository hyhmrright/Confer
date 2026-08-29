import { describe, expect, test } from 'bun:test';
import { LLM_PROVIDER_IDS } from '../llm/catalog.js';
import { agentModelConfigSchema, updateAgentRequestSchema } from './agent.js';

// The provider list here spelled out five vendors inline and had fallen thirteen
// behind the catalogue. It could drift that far because nothing imported it, so
// nothing ever disagreed with it. These tests are that missing disagreement: the
// first one fails the moment the two stop matching, in either direction.
describe('agentModelConfigSchema', () => {
  test('accepts every vendor the catalogue carries', () => {
    const rejected = LLM_PROVIDER_IDS.filter(
      (id) => !agentModelConfigSchema.safeParse({ provider: id, model: 'x' }).success,
    );
    expect(rejected).toEqual([]);
  });

  test('rejects a vendor the catalogue does not carry', () => {
    expect(agentModelConfigSchema.safeParse({ provider: 'not-a-vendor' }).success).toBe(false);
  });

  // The shape the settings screen actually sends. It clears a field by sending
  // an empty string, and saves before every field is filled in — an agent with
  // a provider but no model yet is a normal state, not a rejected request.
  test('accepts the partially configured shape the settings screen saves', () => {
    expect(agentModelConfigSchema.safeParse({}).success).toBe(true);
    expect(agentModelConfigSchema.safeParse({ provider: '', model: '' }).success).toBe(true);
    expect(
      agentModelConfigSchema.safeParse({ provider: 'openai', model: '', system_prompt: 'hi' })
        .success,
    ).toBe(true);
  });
});

describe('updateAgentRequestSchema', () => {
  test('accepts the body the settings screen sends', () => {
    const result = updateAgentRequestSchema.safeParse({
      name: 'My agent',
      description: undefined,
      is_public: true,
      model_config_json: { provider: 'ollama', model: 'qwen3', system_prompt: undefined },
    });
    expect(result.success).toBe(true);
  });

  // Every one of these reached a column unchecked and failed in Postgres
  // instead — a 500 where the caller deserves a 400, and for `is_public` a
  // write that decides whether the agent is discoverable at all.
  test('rejects values the columns cannot hold', () => {
    expect(updateAgentRequestSchema.safeParse({ name: 'x'.repeat(129) }).success).toBe(false);
    expect(updateAgentRequestSchema.safeParse({ is_public: 'yes' }).success).toBe(false);
    expect(updateAgentRequestSchema.safeParse({ style: 'shouty' }).success).toBe(false);
    expect(updateAgentRequestSchema.safeParse({ primary_language: 'far-too-long' }).success).toBe(
      false,
    );
  });

  test('drops fields the route must never let a caller set', () => {
    const result = updateAgentRequestSchema.parse({
      name: 'ok',
      status: 'active',
      did: 'did:web:x',
    });
    expect(result).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('did');
  });
});
