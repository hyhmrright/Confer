import { z } from 'zod';

export const userPreferencesSchema = z.object({
  language: z.string().default('zh'),
  timezone: z.string().default('Asia/Shanghai'),
  notification: z
    .object({
      push: z.boolean().default(true),
      email: z.boolean().default(false),
    })
    .default({}),
  privacy: z
    .object({
      allow_offline_response: z.boolean().default(true),
    })
    .default({}),
});

export const encryptedKeySchema = z.object({
  ciphertext: z.string(),
  iv: z.string(),
  tag: z.string(),
});

export const llmKeysSchema = z.object({
  openai: encryptedKeySchema.optional(),
  anthropic: encryptedKeySchema.optional(),
  deepseek: encryptedKeySchema.optional(),
  qwen: encryptedKeySchema.optional(),
});

export const userSchema = z.object({
  id: z.string().length(26),
  username: z.string().min(1).max(64),
  email: z.string().email().optional(),
  phone: z.string().max(32).optional(),
  display_name: z.string().max(128).optional(),
  avatar_url: z.string().url().optional(),
  did: z.string(),
  preferences: userPreferencesSchema.default({}),
  llm_keys: llmKeysSchema.default({}),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
  deleted_at: z.coerce.date().optional(),
});

export const registerRequestSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9_-]+$/),
  email: z.string().email().optional(),
  password: z.string().min(8).max(128),
  display_name: z.string().max(128).optional(),
});

export const loginRequestSchema = z.object({
  username: z.string(),
  password: z.string(),
  device_id: z.string().max(64),
  device_info: z
    .object({
      platform: z.string().optional(),
      model: z.string().optional(),
      os: z.string().optional(),
    })
    .optional(),
});

export type User = z.infer<typeof userSchema>;
export type UserPreferences = z.infer<typeof userPreferencesSchema>;
export type LLMKeys = z.infer<typeof llmKeysSchema>;
export type EncryptedKey = z.infer<typeof encryptedKeySchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
