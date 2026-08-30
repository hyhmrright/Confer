import { decrypt, type EncryptedValue } from '@confer/shared';
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

/**
 * Who the turn's answer is going to.
 *
 * `owner` is the web chat: the owner is asking their own agent, and everything
 * they own is fair game. `peer` is an inbound A2A question, where the reply
 * leaves the instance — so what the turn can reach has to be bounded by
 * something the peer cannot influence.
 */
export type TurnAudience = 'owner' | 'peer';

export interface AgentCapabilities {
  // Empty string when the owner has no usable embedding key: disables recall.
  embeddingKey: string;
  embeddingProvider: EmbeddingProvider;
  // Empty string when no Tavily key resolves: web_search is then not offered.
  tavilyApiKey: string;
  hasKb: boolean;
  // The only knowledge bases this turn may search, or undefined for "no limit".
  // An EMPTY array means none — never "all", which is the trap in the shape
  // `searchChunks` uses, where an absent list means unrestricted.
  kbScope?: string[];
  // Whether the owner's long-term memory may be recalled into the prompt.
  recallMemory: boolean;
}

// Resolve the capabilities one agent turn runs with, all against the owner's
// own keys — the peer never spends their own. Each degrades independently when
// its key is absent (no KB search / no memory recall / no web_search).
//
// The two audiences deliberately do NOT get the same capabilities. A turn
// answering a peer is bounded twice over: it may search only the knowledge
// bases the owner marked shareable, and it recalls no long-term memory at all.
// Both bounds are computed here, from the owner's own configuration, and are
// therefore unreachable by anything the peer writes into their question —
// which is the point, because the peer's text and the owner's instructions
// arrive at the model as the same kind of thing, and no amount of prompting
// makes "the agent decides what to reveal" into a boundary.
export async function resolveAgentCapabilities(
  userId: string,
  llmKeys: Record<string, unknown>,
  env: { ENCRYPTION_KEY: string; TAVILY_API_KEY: string },
  // Required, not defaulted: the permissive value is the one a forgotten
  // argument would land on, and this is the argument that decides whether a
  // stranger's question can read the owner's documents.
  audience: TurnAudience,
): Promise<AgentCapabilities> {
  const embeddingConfig = await resolveEmbeddingKey(llmKeys, env.ENCRYPTION_KEY);
  const embeddingKey = embeddingConfig?.apiKey ?? '';

  const userKbs = embeddingKey
    ? await getDb()
        .select({ id: knowledgeBases.id, shared: knowledgeBases.shared_with_peers })
        .from(knowledgeBases)
        .where(eq(knowledgeBases.user_id, userId))
    : [];

  const kbScope =
    audience === 'peer' ? userKbs.filter((kb) => kb.shared).map((kb) => kb.id) : undefined;

  const userTavilyKey = await decryptUserKey(llmKeys, 'tavily', env.ENCRYPTION_KEY);

  return {
    embeddingKey,
    embeddingProvider: embeddingConfig?.provider ?? 'openai',
    tavilyApiKey: userTavilyKey || env.TAVILY_API_KEY,
    hasKb: kbScope ? kbScope.length > 0 : userKbs.length > 0,
    kbScope,
    // Long-term memory is distilled from whatever the owner said in their own
    // chats; nothing marks a fact in it as fit to leave the instance, so none
    // of it does. Extraction still runs on A2A turns — recording that a peer
    // asked something is useful, and those rows are tagged `a2a`.
    recallMemory: audience === 'owner',
  };
}
