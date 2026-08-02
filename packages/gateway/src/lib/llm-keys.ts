import { type EncryptedValue, decrypt } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { knowledgeBases, users } from '../db/schema.js';
import { EMBEDDING_PROVIDER_PRIORITY, type EmbeddingProvider } from './embedding.js';

// Helpers for reading a user's per-provider encrypted API keys
// (users.llm_keys_json, AES-256-GCM). Centralised so the read + decrypt +
// "absent key" fallback behave identically across the chat, A2A, and
// knowledge-base routes.

// Load a user's encrypted key map (provider name -> EncryptedValue). Callers
// that need several keys load this once and decrypt individually.
export async function getUserLlmKeys(userId: string): Promise<Record<string, unknown>> {
  const [row] = await getDb()
    .select({ llm_keys_json: users.llm_keys_json })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return (row?.llm_keys_json ?? {}) as Record<string, unknown>;
}

// Decrypt one named key from an already-loaded key map. Returns '' when the key
// is absent or cannot be decrypted — callers treat '' as "not configured".
export async function decryptUserKey(
  llmKeys: Record<string, unknown>,
  name: string,
  encryptionKey: string,
): Promise<string> {
  const encrypted = llmKeys[name] as EncryptedValue | undefined;
  if (!encrypted) return '';
  const result = await decrypt(encrypted, encryptionKey);
  return result.ok ? result.value : '';
}

// Pick the first embedding provider (by priority) the user has a usable key for,
// or null when none is configured.
export async function resolveEmbeddingKey(
  llmKeys: Record<string, unknown>,
  encryptionKey: string,
): Promise<{ apiKey: string; provider: EmbeddingProvider } | null> {
  for (const provider of EMBEDDING_PROVIDER_PRIORITY) {
    const apiKey = await decryptUserKey(llmKeys, provider, encryptionKey);
    if (apiKey) return { apiKey, provider };
  }
  return null;
}

export interface AgentCapabilities {
  // Empty string when the owner has no usable embedding key: disables recall.
  embeddingKey: string;
  embeddingProvider: EmbeddingProvider;
  // Empty string when no Tavily key resolves: web_search is then not offered.
  tavilyApiKey: string;
  hasKb: boolean;
}

// Resolve the capabilities one agent turn runs with, all against the owner's
// own keys. Each degrades independently when its key is absent (no KB search /
// no memory recall / no web_search). Shared by the chat and A2A turn paths so
// a peer-driven turn is never more or less capable than an owner-driven one.
export async function resolveAgentCapabilities(
  userId: string,
  llmKeys: Record<string, unknown>,
  env: { ENCRYPTION_KEY: string; TAVILY_API_KEY: string },
): Promise<AgentCapabilities> {
  const embeddingConfig = await resolveEmbeddingKey(llmKeys, env.ENCRYPTION_KEY);
  const embeddingKey = embeddingConfig?.apiKey ?? '';

  const userKbs = embeddingKey
    ? await getDb()
        .select({ id: knowledgeBases.id })
        .from(knowledgeBases)
        .where(eq(knowledgeBases.user_id, userId))
    : [];

  const userTavilyKey = await decryptUserKey(llmKeys, 'tavily', env.ENCRYPTION_KEY);

  return {
    embeddingKey,
    embeddingProvider: embeddingConfig?.provider ?? 'openai',
    tavilyApiKey: userTavilyKey || env.TAVILY_API_KEY,
    hasKb: userKbs.length > 0,
  };
}
