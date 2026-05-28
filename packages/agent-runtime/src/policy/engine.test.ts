import { describe, expect, test } from 'bun:test';
import {
  type PolicyConfig,
  type PolicyRequest,
  classifyPermissionLevel,
  evaluatePolicy,
  parsePolicyConfig,
} from './engine.js';

describe('classifyPermissionLevel', () => {
  test('classifies read-only / query actions as L1', () => {
    expect(classifyPermissionLevel('read_own_profile')).toBe('L1');
    expect(classifyPermissionLevel('cite_own_docs')).toBe('L1');
    expect(classifyPermissionLevel('query_knowledge_base')).toBe('L1');
  });

  test('classifies irreversible / sensitive actions as L3', () => {
    expect(classifyPermissionLevel('payment')).toBe('L3');
    expect(classifyPermissionLevel('sign_contract')).toBe('L3');
    expect(classifyPermissionLevel('delete_document')).toBe('L3');
    expect(classifyPermissionLevel('transfer_funds')).toBe('L3');
    expect(classifyPermissionLevel('accept_invite')).toBe('L3');
  });

  test('defaults everything else to L2', () => {
    expect(classifyPermissionLevel('send_message')).toBe('L2');
    expect(classifyPermissionLevel('unknown_action')).toBe('L2');
  });
});

describe('evaluatePolicy', () => {
  const req = (overrides: Partial<PolicyRequest> = {}): PolicyRequest => ({
    action: 'send_message',
    peer_did: 'did:web:peer.com',
    level: 'L2',
    ...overrides,
  });

  test('always allows L1 regardless of config', () => {
    expect(evaluatePolicy(req({ level: 'L1' }), { default_decision: 'deny', rules: [] })).toBe(
      'allow',
    );
  });

  test('always asks the user for L3 regardless of config', () => {
    expect(evaluatePolicy(req({ level: 'L3' }), { default_decision: 'allow', rules: [] })).toBe(
      'ask_user',
    );
  });

  test('falls back to the default decision when no L2 rule matches', () => {
    expect(evaluatePolicy(req(), { default_decision: 'deny', rules: [] })).toBe('deny');
  });

  test('applies the first matching L2 rule', () => {
    const config: PolicyConfig = {
      default_decision: 'ask_user',
      rules: [{ action: 'send_message', decision: 'allow' }],
    };
    expect(evaluatePolicy(req({ action: 'send_message_now' }), config)).toBe('allow');
  });

  test('matches a wildcard action rule', () => {
    const config: PolicyConfig = {
      default_decision: 'deny',
      rules: [{ action: '*', decision: 'allow' }],
    };
    expect(evaluatePolicy(req(), config)).toBe('allow');
  });

  test('honors a peer-scoped rule only for the matching peer', () => {
    const config: PolicyConfig = {
      default_decision: 'deny',
      rules: [{ action: '*', peer_did: 'did:web:trusted.com', decision: 'allow' }],
    };
    expect(evaluatePolicy(req({ peer_did: 'did:web:trusted.com' }), config)).toBe('allow');
    expect(evaluatePolicy(req({ peer_did: 'did:web:other.com' }), config)).toBe('deny');
  });
});

describe('parsePolicyConfig', () => {
  test('returns the safe default for non-object input', () => {
    for (const input of [null, undefined, 'string', 42]) {
      expect(parsePolicyConfig(input)).toEqual({ default_decision: 'ask_user', rules: [] });
    }
  });

  test('reads default_decision from the "default" key', () => {
    expect(parsePolicyConfig({ default: 'allow', rules: [] }).default_decision).toBe('allow');
  });

  test('falls back when the default decision is invalid', () => {
    expect(parsePolicyConfig({ default: 'maybe' }).default_decision).toBe('ask_user');
  });

  test('keeps valid rules and drops malformed ones', () => {
    const config = parsePolicyConfig({
      default: 'deny',
      rules: [
        { action: 'send', decision: 'allow' },
        { action: 'no_decision' },
        { decision: 'allow' },
        { action: 'bad', decision: 'maybe' },
        'not-an-object',
      ],
    });
    expect(config.rules).toEqual([{ action: 'send', peer_did: undefined, decision: 'allow' }]);
  });

  test('treats a non-array rules field as empty', () => {
    expect(parsePolicyConfig({ default: 'allow', rules: 'nope' }).rules).toEqual([]);
  });
});
