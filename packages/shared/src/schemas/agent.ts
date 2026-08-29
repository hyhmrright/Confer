import { z } from 'zod';
import { LLM_PROVIDER_IDS } from '../llm/catalog.js';

export const modelChoiceSchema = z.object({
  // Asked of the catalogue rather than listed here. This used to spell out five
  // vendors and had fallen thirteen behind — the same drift, and for the same
  // reason, as the `llmKeysSchema` deleted from user.ts. Written as a refine
  // instead of an enum because `LLM_PROVIDER_IDS` is a derived array, not a
  // literal tuple; it is the same check `routes/users.ts` runs on the live path.
  provider: z.string().refine((id) => LLM_PROVIDER_IDS.includes(id), 'Unknown provider'),
  model: z.string(),
  temperature: z.number().min(0).max(2).optional(),
});

export const modelConfigSchema = z.object({
  brain: modelChoiceSchema.default({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' }),
  quick: modelChoiceSchema.default({ provider: 'deepseek', model: 'deepseek-chat' }),
  translation: modelChoiceSchema.default({ provider: 'deepseek', model: 'deepseek-chat' }),
  summarize: modelChoiceSchema.default({ provider: 'deepseek', model: 'deepseek-chat' }),
});

// AgentFacts policy advertisement shape. NOTE: intentionally distinct from the
// agent-runtime engine's runtime PolicyRule ({ action, peer_did?, decision }),
// which is what `agents.policies_json` is actually evaluated against. These two
// vocabularies (effect/ask here vs decision/ask_user there) must be reconciled
// before any code feeds one into the other — see agent-runtime policy/engine.ts.
export const policyRuleSchema = z.object({
  peer: z.string().optional(),
  action: z.enum(['read', 'ask', 'share', 'commit']),
  pattern: z.string().optional(),
  effect: z.enum(['allow', 'deny', 'ask']),
});

export const policyConfigSchema = z.object({
  default: z.enum(['auto', 'ask', 'deny']).default('ask'),
  rules: z.array(policyRuleSchema).default([]),
});

export const capabilitySchema = z.object({
  type: z.string(),
  scope: z.array(z.string()),
  languages: z.array(z.string()),
});

export const agentSchema = z.object({
  id: z.string().length(26),
  user_id: z.string().length(26),
  did: z.string(),
  name: z.string().max(128).optional(),
  description: z.string().optional(),
  avatar_url: z.string().url().optional(),
  primary_language: z.string().default('zh'),
  style: z.enum(['formal', 'friendly', 'technical', 'casual']).default('friendly'),
  model_config: modelConfigSchema.prefault({}),
  policies: policyConfigSchema.prefault({}),
  capabilities: z.array(capabilitySchema).default([]),
  is_public: z.boolean().default(false),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export type Agent = z.infer<typeof agentSchema>;
export type ModelConfig = z.infer<typeof modelConfigSchema>;
export type PolicyConfig = z.infer<typeof policyConfigSchema>;
export type PolicyRule = z.infer<typeof policyRuleSchema>;
