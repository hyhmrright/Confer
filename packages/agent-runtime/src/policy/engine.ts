export type PermissionLevel = 'L1' | 'L2' | 'L3';

export type PolicyDecision = 'allow' | 'deny' | 'ask_user';

// NOTE: this is the AUTHORITATIVE runtime shape — `parsePolicyConfig` reads
// `agents.policies_json` as { action, peer_did?, decision } and the gateway's
// PUT /me/policies stores whatever the client sends here. It deliberately does
// NOT match @confer/shared `policyRuleSchema` ({ peer, action, pattern, effect }),
// which describes the AgentFacts policy advertisement, a separate concern.
// Do not bridge AgentFacts.policies into policies_json without reconciling the
// two vocabularies first — parseRule() silently drops rules lacking `decision`.
export interface PolicyRule {
  action: string;
  peer_did?: string;
  decision: PolicyDecision;
}

export interface PolicyConfig {
  default_decision: PolicyDecision;
  rules: PolicyRule[];
}

export interface PolicyRequest {
  action: string;
  peer_did: string;
  level: PermissionLevel;
}

// Default to `allow` for L2 with no matching rule. The only runtime caller is
// the inbound A2A handler, which runs this AFTER the consent gate — so a
// connected peer asking an ordinary question is already consented ("connection
// is the consent for ordinary questions", per a2a.ts). Owners opt into the
// "ask me first" offline-answer gate explicitly, via either
// `policies_json.default = 'ask_user'` or a `{ action: 'ask', decision:
// 'ask_user' }` rule. L3 actions still hard-return `ask_user` regardless.
const DEFAULT_CONFIG: PolicyConfig = {
  default_decision: 'allow',
  rules: [],
};

export function classifyPermissionLevel(action: string): PermissionLevel {
  const l1Actions = ['read_own', 'cite_own_docs', 'query'];
  const l3Actions = ['accept_invite', 'payment', 'sign_contract', 'delete', 'transfer'];

  if (l1Actions.some((a) => action.startsWith(a))) return 'L1';
  if (l3Actions.some((a) => action.startsWith(a))) return 'L3';
  return 'L2';
}

export function evaluatePolicy(
  request: PolicyRequest,
  config: PolicyConfig = DEFAULT_CONFIG,
): PolicyDecision {
  if (request.level === 'L1') {
    return 'allow';
  }

  if (request.level === 'L3') {
    return 'ask_user';
  }

  for (const rule of config.rules) {
    const actionMatch = rule.action === '*' || request.action.startsWith(rule.action);
    const peerMatch = !rule.peer_did || rule.peer_did === request.peer_did;

    if (actionMatch && peerMatch) {
      return rule.decision;
    }
  }

  return config.default_decision;
}

export function parsePolicyConfig(json: unknown): PolicyConfig {
  if (!json || typeof json !== 'object') {
    return DEFAULT_CONFIG;
  }

  const obj = json as Record<string, unknown>;
  return {
    default_decision: validateDecision(obj.default) ?? DEFAULT_CONFIG.default_decision,
    rules: Array.isArray(obj.rules)
      ? obj.rules.map(parseRule).filter((r): r is PolicyRule => r !== null)
      : [],
  };
}

function parseRule(raw: unknown): PolicyRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const action = typeof obj.action === 'string' ? obj.action : null;
  const decision = validateDecision(obj.decision);

  if (!action || !decision) return null;

  return {
    action,
    peer_did: typeof obj.peer_did === 'string' ? obj.peer_did : undefined,
    decision,
  };
}

function validateDecision(value: unknown): PolicyDecision | null {
  if (value === 'allow' || value === 'deny' || value === 'ask_user') {
    return value;
  }
  return null;
}
