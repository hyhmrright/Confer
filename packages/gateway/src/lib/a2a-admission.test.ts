import { describe, expect, test } from 'bun:test';
import { parsePolicyConfig } from '@confer/agent-runtime';
import { decideAdmission, isSenderAuthorized } from './a2a-admission.js';

// These branches used to live inline in the `POST /a2a/v1/messages` handler,
// where exercising them meant booting Postgres + Qdrant + MinIO and driving a
// signed HTTP request. They are the protocol's admission rules, so they deserve
// direct tests.

describe('isSenderAuthorized', () => {
  test('a key may sign for its own DID', () => {
    expect(isSenderAuthorized('did:web:vendor.com', 'did:web:vendor.com')).toBe(true);
  });

  test('a key may sign for sub-identifiers in its own namespace', () => {
    expect(isSenderAuthorized('did:web:vendor.com', 'did:web:vendor.com:users:li')).toBe(true);
  });

  test('a key may not sign for an unrelated DID', () => {
    expect(isSenderAuthorized('did:web:vendor.com', 'did:web:victim.com')).toBe(false);
  });

  // The prefix check must be namespace-aware, not a bare string prefix:
  // `did:web:vendor.com.evil.test` starts with `did:web:vendor.com` as text but
  // is a different domain entirely.
  test('a lookalike domain that merely shares a text prefix is rejected', () => {
    expect(isSenderAuthorized('did:web:vendor.com', 'did:web:vendor.com.evil.test')).toBe(false);
  });

  test('with no verified signer there is nothing to cross-check', () => {
    expect(isSenderAuthorized(undefined, 'did:web:anyone.com')).toBe(true);
  });
});

describe('decideAdmission', () => {
  const peerDid = 'did:web:peer.example';

  // The policy vocabulary is `policies_json` ({ default, rules: [{ action,
  // peer_did?, decision }] }) — NOT the AgentFacts `policyRuleSchema` shape.
  // engine.ts warns about exactly this: a rule missing `decision` is silently
  // dropped, so a rule written in the wrong vocabulary fails open.

  test('an agent set to allow answers a connected peer', () => {
    const admission = decideAdmission({
      peerDid,
      agentPolicies: parsePolicyConfig({ default: 'allow' }),
      contactOverrides: undefined,
    });
    expect(admission).toBe('answer');
  });

  test('an agent set to ask_user holds the question for the owner', () => {
    const admission = decideAdmission({
      peerDid,
      agentPolicies: parsePolicyConfig({ default: 'ask_user' }),
      contactOverrides: undefined,
    });
    expect(admission).toBe('hold');
  });

  test('an agent set to deny refuses even a connected peer', () => {
    const admission = decideAdmission({
      peerDid,
      agentPolicies: parsePolicyConfig({ default: 'deny' }),
      contactOverrides: undefined,
    });
    expect(admission).toBe('deny');
  });

  test('a per-contact override wins over the agent default', () => {
    const admission = decideAdmission({
      peerDid,
      agentPolicies: parsePolicyConfig({ default: 'allow' }),
      contactOverrides: { default: 'ask_user' },
    });
    expect(admission).toBe('hold');
  });

  // The identity case, and the reason mergePolicyConfig takes the RAW override:
  // an empty `{}` must not reset an agent's `ask_user` back to the permissive
  // default that parsePolicyConfig would fill in.
  test('an empty override leaves the agent decision untouched', () => {
    for (const [config, expected] of [
      ['allow', 'answer'],
      ['ask_user', 'hold'],
      ['deny', 'deny'],
    ] as const) {
      expect(
        decideAdmission({
          peerDid,
          agentPolicies: parsePolicyConfig({ default: config }),
          contactOverrides: {},
        }),
      ).toBe(expected);
    }
  });

  test('a contact rule matching this peer beats the agent default', () => {
    const admission = decideAdmission({
      peerDid,
      agentPolicies: parsePolicyConfig({ default: 'allow' }),
      contactOverrides: {
        rules: [{ action: 'ask', peer_did: peerDid, decision: 'deny' }],
      },
    });
    expect(admission).toBe('deny');
  });

  test('a contact rule naming a different peer does not apply', () => {
    const admission = decideAdmission({
      peerDid,
      agentPolicies: parsePolicyConfig({ default: 'allow' }),
      contactOverrides: {
        rules: [{ action: 'ask', peer_did: 'did:web:someone.else', decision: 'deny' }],
      },
    });
    expect(admission).toBe('answer');
  });
});
