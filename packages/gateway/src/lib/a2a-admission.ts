import type { PolicyConfig } from '@confer/agent-runtime';
import { classifyPermissionLevel, evaluatePolicy, mergePolicyConfig } from '@confer/agent-runtime';

// The admission decisions for an inbound A2A message, lifted out of the HTTP
// handler in `routes/a2a.ts`.
//
// Both functions here are pure. That is the point: this is the most
// security-sensitive judgment the protocol makes — who may speak to an owner's
// agent, and whether the agent may answer without asking first — and inline in
// a route handler it could only be exercised by starting Postgres, Qdrant and
// MinIO and driving a signed HTTP request. Now it has unit tests
// (`a2a-admission.test.ts`) that enumerate the branches directly.
//
// What is deliberately NOT here: the DB lookups and side effects (resolving the
// peer, holding a connection request, storing and broadcasting the message).
// Those stay in the handler, which reads as: gather inputs → decide → act.

// Whether a signed request may claim to speak `from` a given DID.
//
// A signing key authorizes its own DID and any sub-identifier beneath it —
// did:web:vendor.com may sign for did:web:vendor.com:users:li, because the
// vendor operates that namespace. It may not sign for an unrelated DID;
// otherwise one valid key would let a peer forge connection requests under any
// identity, and the owner's consent gate would be deciding about the wrong peer.
//
// `signerDid` is undefined only when signature verification did not run, which
// the caller treats as "nothing to cross-check" rather than as authorization.
export function isSenderAuthorized(signerDid: string | undefined, from: string): boolean {
  if (!signerDid) return true;
  return from === signerDid || from.startsWith(`${signerDid}:`);
}

// What to do with an inbound message from an already-connected peer.
//
// - 'deny'   → refuse (403); an explicit policy rule rejected this peer
// - 'hold'   → store and show it to the owner, but do not answer until approved
// - 'answer' → store, show, and let the agent reply
export type Admission = 'deny' | 'hold' | 'answer';

// The connection itself is the consent for ordinary questions; an explicit
// policy rule can still deny a specific connected peer. The owner can also set a
// per-contact standing policy (e.g. "always ask me first for this peer"), which
// layers over the agent-level config: the contact default overrides the agent
// default when set, and contact rules match before agent rules. With no contact
// row or an empty `{}` override, the merge is the identity — the decision is
// byte-identical to the agent-only path.
export function decideAdmission(input: {
  peerDid: string;
  agentPolicies: PolicyConfig;
  contactOverrides: unknown;
}): Admission {
  const policyConfig = mergePolicyConfig(input.agentPolicies, input.contactOverrides);
  const decision = evaluatePolicy(
    { action: 'ask', peer_did: input.peerDid, level: classifyPermissionLevel('ask') },
    policyConfig,
  );

  if (decision === 'deny') return 'deny';
  return decision === 'ask_user' ? 'hold' : 'answer';
}
