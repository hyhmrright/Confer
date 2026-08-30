import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { knowledgeBases, peerAgents, peerContacts } from '../db/schema.js';
import { type EmbeddingProvider, embedTexts } from '../lib/embedding.js';
import { searchMemories } from '../lib/memory-store.js';

// Tools that let the agent see what the owner actually has, rather than guess.
//
// The agent had two tools, both of which act on a target it has to name blind:
// it could search a knowledge base without knowing which ones exist, and it had
// no way to ask what it already knows or who it can reach. These three answer
// "what is available", which is the question that has to come first.
//
// Every one of them reads owner-scoped data, so each carries an explicit answer
// to "may a peer call this" — see `resolveAgentCapabilities`, where the same
// question is settled for the knowledge base and long-term memory. `peer_agents`
// rows are global (one row per DID, shared across every user who added that
// peer), so contact queries scope by `peer_contacts.user_id` and never by peer
// id alone; that mistake has produced a real cross-tenant leak in this codebase
// before.

// Bounds on what reaches the prompt. These are context budget, not pagination:
// an owner with 200 contacts does not want 200 lines of them in every turn.
const MAX_KBS = 50;
const MAX_CONTACTS = 50;
const MEMORY_TOP_K = 10;
const MEMORY_MIN_SCORE = 0.3;

export const listKnowledgeBasesToolDefinition = {
  name: 'list_knowledge_bases',
  description:
    '列出当前可检索的知识库及其 id、名称和描述。当不确定该搜哪个知识库时，先调用这个工具，再用 search_knowledge_base 的 kb_ids 参数精确检索。',
  parameters: { type: 'object', properties: {}, required: [] },
} as const;

/**
 * List the knowledge bases this turn may search.
 *
 * `kbScope` is the same ceiling `search_knowledge_base` enforces, applied here
 * so the two agree: listing a knowledge base the subsequent search would refuse
 * is worse than not listing it, because the model would keep retrying against a
 * name that silently returns nothing.
 */
export async function listKnowledgeBases(userId: string, kbScope?: string[]): Promise<string> {
  // An empty scope admits nothing, so there is nothing to ask the database.
  // Checked rather than assumed: drizzle compiles `inArray(x, [])` to a literal
  // `false`, so the query would return nothing either way. This saves a round
  // trip and states the intent — it is not the thing keeping the scope closed.
  if (kbScope?.length === 0) return '当前没有可检索的知识库。';

  const where = kbScope
    ? and(eq(knowledgeBases.user_id, userId), inArray(knowledgeBases.id, kbScope))
    : eq(knowledgeBases.user_id, userId);

  const rows = await getDb()
    .select({
      id: knowledgeBases.id,
      name: knowledgeBases.name,
      description: knowledgeBases.description,
    })
    .from(knowledgeBases)
    .where(where)
    .limit(MAX_KBS);

  if (rows.length === 0) return '当前没有可检索的知识库。';

  return rows
    .map((kb) => `- ${kb.name}（id: ${kb.id}）${kb.description ? `：${kb.description}` : ''}`)
    .join('\n');
}

export const searchMemoryToolDefinition = {
  name: 'search_memory',
  description:
    '在关于该用户的长期记忆中检索。每轮对话已自动注入最相关的几条记忆，当需要回忆更早、更具体的事实（例如用户之前的偏好、决定、人名）时再调用这个工具。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '要回忆的内容，用自然语言描述' },
    },
    required: ['query'],
  },
} as const;

/**
 * Search the owner's long-term memory on demand.
 *
 * Automatic recall already injects the top few memories for the user's message,
 * but it is scored against that message alone — a turn that needs to remember
 * something the user did not just mention has no way to reach it. This is that
 * way, and it is why the tool is worth having on top of the existing recall.
 *
 * Never offered on a peer turn. Long-term memory is distilled from the owner's
 * own chats and nothing in it is marked fit to leave the instance, which is the
 * same reason automatic recall is off there.
 */
export async function searchMemory(
  query: string,
  userId: string,
  embeddingKey: string,
  embeddingProvider: EmbeddingProvider,
): Promise<string> {
  const [vector] = await embedTexts([query], embeddingKey, embeddingProvider);
  if (!vector) return '记忆检索失败。';

  const hits = await searchMemories(
    vector,
    userId,
    MEMORY_TOP_K,
    MEMORY_MIN_SCORE,
    embeddingProvider,
  );
  if (hits.length === 0) return '没有找到相关的记忆。';

  // Same attribution automatic recall uses: a fact distilled from a peer's
  // question describes that inquiry, not the owner, and listing it bare reads
  // as something the owner wants.
  return hits
    .map((hit) =>
      hit.source === 'a2a' ? `- （来自外部 Agent 的提问）${hit.text}` : `- ${hit.text}`,
    )
    .join('\n');
}

export const listContactsToolDefinition = {
  name: 'list_contacts',
  description:
    '列出用户已连接的联系人 Agent（名称、所属组织、备注）。当用户问起“我能问谁”“有哪些联系人”，或需要判断某个问题该转给谁时调用。',
  parameters: { type: 'object', properties: {}, required: [] },
} as const;

/**
 * List the owner's connected peer agents.
 *
 * Owner-only. A contact list is the owner's social graph; handing it to a peer
 * would tell a stranger who else the owner talks to, which no part of answering
 * their question requires.
 */
export async function listContacts(userId: string): Promise<string> {
  const rows = await getDb()
    .select({
      alias: peerContacts.alias,
      name: peerAgents.name,
      organization: peerAgents.organization,
      description: peerAgents.description,
    })
    .from(peerContacts)
    .innerJoin(peerAgents, eq(peerContacts.peer_id, peerAgents.id))
    // Scoped by the CONTACT's owner, never by peer id: `peer_agents` is global,
    // so one row is shared by every user who added that peer.
    .where(eq(peerContacts.user_id, userId))
    .orderBy(desc(peerContacts.pinned))
    .limit(MAX_CONTACTS);

  if (rows.length === 0) return '还没有已连接的联系人。';

  return rows
    .map((row) => {
      const name = row.alias ?? row.name ?? '(未命名)';
      const org = row.organization ? `（${row.organization}）` : '';
      return `- ${name}${org}${row.description ? `：${row.description}` : ''}`;
    })
    .join('\n');
}
