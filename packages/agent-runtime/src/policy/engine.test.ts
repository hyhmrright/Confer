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

  test('an empty policy config allows L2 by default (connection is the consent)', () => {
    expect(evaluatePolicy(req(), parsePolicyConfig({}))).toBe('allow');
    expect(evaluatePolicy(req(), parsePolicyConfig(null))).toBe('allow');
  });

  test('an explicit default of ask_user holds L2 with no matching rule for owner review', () => {
    expect(evaluatePolicy(req(), parsePolicyConfig({ default: 'ask_user' }))).toBe('ask_user');
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

  test('a rule with no peer_did matches any peer', () => {
    const config: PolicyConfig = {
      default_decision: 'deny',
      rules: [{ action: 'send_message', decision: 'allow' }],
    };
    expect(evaluatePolicy(req({ peer_did: 'did:web:a.com' }), config)).toBe('allow');
    expect(evaluatePolicy(req({ peer_did: 'did:web:b.com' }), config)).toBe('allow');
  });

  test('a rule with an explicitly undefined peer_did still matches any peer', () => {
    const config: PolicyConfig = {
      default_decision: 'deny',
      rules: [{ action: 'send_message', peer_did: undefined, decision: 'allow' }],
    };
    expect(evaluatePolicy(req({ peer_did: 'did:web:anything.com' }), config)).toBe('allow');
  });

  test('wildcard action combined with a peer restriction gates strictly on the peer', () => {
    const config: PolicyConfig = {
      default_decision: 'ask_user',
      rules: [{ action: '*', peer_did: 'did:web:trusted.com', decision: 'allow' }],
    };
    // any action from the trusted peer is allowed by the wildcard
    expect(
      evaluatePolicy(
        req({ action: 'some_random_action', peer_did: 'did:web:trusted.com' }),
        config,
      ),
    ).toBe('allow');
    // same action from a different peer does not match -> default
    expect(
      evaluatePolicy(req({ action: 'some_random_action', peer_did: 'did:web:other.com' }), config),
    ).toBe('ask_user');
  });

  test('an empty-string rule action matches every request action via startsWith', () => {
    const config: PolicyConfig = {
      default_decision: 'deny',
      rules: [{ action: '', decision: 'allow' }],
    };
    expect(evaluatePolicy(req({ action: 'anything' }), config)).toBe('allow');
    expect(evaluatePolicy(req({ action: '' }), config)).toBe('allow');
  });

  test('an empty-string request action falls through to the default when no rule matches', () => {
    const config: PolicyConfig = {
      default_decision: 'deny',
      rules: [{ action: 'send_message', decision: 'allow' }],
    };
    // '' does not start with 'send_message', so no rule matches
    expect(evaluatePolicy(req({ action: '' }), config)).toBe('deny');
  });
});

describe('parsePolicyConfig', () => {
  test('returns the safe default for non-object input', () => {
    for (const input of [null, undefined, 'string', 42]) {
      expect(parsePolicyConfig(input)).toEqual({ default_decision: 'allow', rules: [] });
    }
  });

  test('reads default_decision from the "default" key', () => {
    expect(parsePolicyConfig({ default: 'ask_user', rules: [] }).default_decision).toBe('ask_user');
  });

  test('falls back when the default decision is invalid', () => {
    expect(parsePolicyConfig({ default: 'maybe' }).default_decision).toBe('allow');
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
