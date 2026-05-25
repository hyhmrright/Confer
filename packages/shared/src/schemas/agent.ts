import { z } from 'zod';

export const modelChoiceSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'deepseek', 'qwen', 'ollama']),
  model: z.string(),
  temperature: z.number().min(0).max(2).optional(),
});

export const modelConfigSchema = z.object({
  brain: modelChoiceSchema.default({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' }),
  quick: modelChoiceSchema.default({ provider: 'deepseek', model: 'deepseek-chat' }),
  translation: modelChoiceSchema.default({ provider: 'deepseek', model: 'deepseek-chat' }),
  summarize: modelChoiceSchema.default({ provider: 'deepseek', model: 'deepseek-chat' }),
});

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
  model_config: modelConfigSchema.default({}),
  policies: policyConfigSchema.default({}),
  capabilities: z.array(capabilitySchema).default([]),
  is_public: z.boolean().default(false),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export type Agent = z.infer<typeof agentSchema>;
export type ModelConfig = z.infer<typeof modelConfigSchema>;
export type ModelChoice = z.infer<typeof modelChoiceSchema>;
export type PolicyConfig = z.infer<typeof policyConfigSchema>;
export type PolicyRule = z.infer<typeof policyRuleSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
