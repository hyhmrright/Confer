import { z } from 'zod';
import { LLM_PROVIDER_IDS } from '../llm/catalog.js';

/**
 * What `agents.model_config_json` actually holds.
 *
 * It used to be described here as four named roles — brain / quick /
 * translation / summarize, each a provider+model pair, each with a hardcoded
 * vendor default. No screen has ever written that, and nothing has ever read
 * it: the settings UI saves `{provider, model, system_prompt}` flat, and
 * `resolveAgentModel` reads exactly those. The role-based version was a design
 * that never shipped, left behind as a schema, and because nothing imported it
 * nothing ever disagreed with it — which is also how its vendor list drifted
 * thirteen entries behind the catalogue before anyone noticed.
 *
 * Every field is optional because a half-configured agent is an ordinary state:
 * `resolveAgentModel` reports `no_model_configured` for it rather than treating
 * it as invalid input. The provider, when given, is asked of the catalogue —
 * the same check `routes/users.ts` runs when a key is stored for one.
 */
export const agentModelConfigSchema = z.object({
  provider: z
    .string()
    .refine((id) => id === '' || LLM_PROVIDER_IDS.includes(id), 'Unknown provider')
    .optional(),
  model: z.string().max(128).optional(),
  system_prompt: z.string().max(8000).optional(),
});

/** Body of `PATCH /api/v1/agents/me`. Absent fields are left as they were. */
export const updateAgentRequestSchema = z.object({
  name: z.string().max(128).nullish(),
  description: z.string().max(4000).nullish(),
  avatar_url: z.string().max(2048).nullish(),
  // Not nullable: the column is NOT NULL with a default, so "clear it" has no
  // meaning — there is always a language, and this is the only way to change it.
  primary_language: z.string().max(8).optional(),
  style: z.enum(['formal', 'friendly', 'technical', 'casual']).nullish(),
  model_config_json: agentModelConfigSchema.optional(),
  capabilities_json: z.array(z.record(z.string(), z.unknown())).max(64).optional(),
  is_public: z.boolean().optional(),
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

// `agentSchema` and `capabilitySchema` stood here, mirroring the `agents` table
// row and the capability objects inside it. Nothing imported either, and
// `agentSchema` embedded the role-based model config described above — so it
// documented a row shape the database does not have. The gateway reads that
// table through Drizzle, which derives the row type from `db/schema.ts`; a
// hand-written second opinion about the same columns can only drift from it.
