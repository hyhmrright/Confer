import {
  boolean,
  char,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: char('id', { length: 26 }).primaryKey(),
    username: varchar('username', { length: 64 }).unique().notNull(),
    email: varchar('email', { length: 255 }).unique(),
    phone: varchar('phone', { length: 32 }).unique(),
    display_name: varchar('display_name', { length: 128 }),
    avatar_url: text('avatar_url'),
    did: varchar('did', { length: 255 }).unique().notNull(),
    password_hash: text('password_hash'),
    // Two-level access role: 'member' (default) or 'admin'. The admin role
    // gates the /api/v1/admin/* surface; it is checked per-request by
    // adminMiddleware (never carried in the JWT) so changes take effect at once.
    role: varchar('role', { length: 16 }).notNull().default('member'),
    // Account lifecycle flag: 'active' (default) or 'disabled'. Disabling soft
    // -locks the account — auth (login/refresh) and adminMiddleware reject it,
    // and its sessions are revoked on disable. Distinct from deleted_at (the
    // account-deletion tombstone).
    status: varchar('status', { length: 16 }).notNull().default('active'),
    preferences_json: jsonb('preferences_json').default({}),
    llm_keys_json: jsonb('llm_keys_json').default({}),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('idx_users_did').on(t.did)],
);

export const agents = pgTable(
  'agents',
  {
    id: char('id', { length: 26 }).primaryKey(),
    user_id: char('user_id', { length: 26 })
      .notNull()
      .references(() => users.id),
    did: varchar('did', { length: 255 }).unique().notNull(),
    name: varchar('name', { length: 128 }),
    description: text('description'),
    avatar_url: text('avatar_url'),
    primary_language: varchar('primary_language', { length: 8 }).notNull().default('zh'),
    style: varchar('style', { length: 32 }).default('friendly'),
    model_config_json: jsonb('model_config_json').default({}),
    policies_json: jsonb('policies_json').default({}),
    capabilities_json: jsonb('capabilities_json').default([]),
    is_public: boolean('is_public').notNull().default(false),
    // Moderation lifecycle: 'active' (default) or 'suspended'. A suspended agent
    // is soft-removed by admins — it is filtered out of public discovery/listing
    // read paths. The AgentFacts/DID document itself is intentionally untouched
    // (avoids touching Contract 3); only this status flag drives filtering.
    status: varchar('status', { length: 16 }).notNull().default('active'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_agents_user').on(t.user_id), index('idx_agents_did').on(t.did)],
);

export const peerAgents = pgTable(
  'peer_agents',
  {
    id: char('id', { length: 26 }).primaryKey(),
    did: varchar('did', { length: 255 }).unique().notNull(),
    name: varchar('name', { length: 128 }),
    description: text('description'),
    avatar_url: text('avatar_url'),
    organization: varchar('organization', { length: 255 }),
    endpoint: text('endpoint').notNull(),
    public_key_json: jsonb('public_key_json').notNull(),
    agent_facts_json: jsonb('agent_facts_json').notNull(),
    fetched_at: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    etag: varchar('etag', { length: 255 }),
    trust_level: varchar('trust_level', { length: 16 }).default('unknown'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_peers_did').on(t.did)],
);

export const peerContacts = pgTable(
  'peer_contacts',
  {
    id: char('id', { length: 26 }).primaryKey(),
    user_id: char('user_id', { length: 26 })
      .notNull()
      .references(() => users.id),
    peer_id: char('peer_id', { length: 26 })
      .notNull()
      .references(() => peerAgents.id),
    alias: varchar('alias', { length: 128 }),
    tags: text('tags').array(),
    pinned: boolean('pinned').default(false),
    muted: boolean('muted').default(false),
    policy_overrides_json: jsonb('policy_overrides_json').default({}),
    added_via: varchar('added_via', { length: 32 }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_peer_contacts_user_peer').on(t.user_id, t.peer_id),
    index('idx_contacts_user').on(t.user_id),
  ],
);

export const conversations = pgTable(
  'conversations',
  {
    id: char('id', { length: 26 }).primaryKey(),
    type: varchar('type', { length: 32 }).notNull(),
    name: varchar('name', { length: 255 }),
    created_by: char('created_by', { length: 26 })
      .notNull()
      .references(() => users.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archived_at: timestamp('archived_at', { withTimezone: true }),
    // Admin moderation flag: 'visible' (default) or 'hidden'. A hidden
    // conversation is filtered from non-admin read paths but never deleted;
    // admins still see it. Distinct from archived_at (user-initiated archive).
    moderation_status: varchar('moderation_status', { length: 16 }).notNull().default('visible'),
  },
  (t) => [index('idx_conversations_created_by').on(t.created_by)],
);

export const conversationParticipants = pgTable(
  'conversation_participants',
  {
    id: char('id', { length: 26 }).primaryKey(),
    conversation_id: char('conversation_id', { length: 26 })
      .notNull()
      .references(() => conversations.id),
    participant_type: varchar('participant_type', { length: 16 }).notNull(),
    user_id: char('user_id', { length: 26 }).references(() => users.id),
    agent_id: char('agent_id', { length: 26 }).references(() => agents.id),
    peer_id: char('peer_id', { length: 26 }).references(() => peerAgents.id),
    role: varchar('role', { length: 16 }).default('member'),
    joined_at: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    last_read_at: timestamp('last_read_at', { withTimezone: true }),
    notification: varchar('notification', { length: 16 }).default('all'),
  },
  (t) => [
    index('idx_participants_conv').on(t.conversation_id),
    index('idx_participants_user').on(t.user_id),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: char('id', { length: 26 }).primaryKey(),
    conversation_id: char('conversation_id', { length: 26 })
      .notNull()
      .references(() => conversations.id),
    sender_type: varchar('sender_type', { length: 16 }).notNull(),
    sender_id: char('sender_id', { length: 26 }).notNull(),
    sender_did: varchar('sender_did', { length: 255 }),
    content_type: varchar('content_type', { length: 32 }).notNull().default('text'),
    content: text('content'),
    content_json: jsonb('content_json'),
    in_reply_to: char('in_reply_to', { length: 26 }),
    thread_root: char('thread_root', { length: 26 }),
    citations_json: jsonb('citations_json'),
    language: varchar('language', { length: 8 }),
    translation_json: jsonb('translation_json'),
    via: varchar('via', { length: 32 }),
    delivery_status: varchar('delivery_status', { length: 16 }),
    delivered_at: timestamp('delivered_at', { withTimezone: true }),
    read_by_json: jsonb('read_by_json').default([]),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
    // Admin moderation flag: 'visible' (default) or 'hidden'. A hidden message
    // is filtered from non-admin read paths but never deleted; admins still see
    // it. Distinct from deleted_at (user-initiated delete).
    moderation_status: varchar('moderation_status', { length: 16 }).notNull().default('visible'),
  },
  (t) => [
    index('idx_messages_conversation_created').on(t.conversation_id, t.created_at),
    index('idx_messages_thread_root').on(t.thread_root),
  ],
);

export const permissions = pgTable(
  'permissions',
  {
    id: char('id', { length: 26 }).primaryKey(),
    user_id: char('user_id', { length: 26 })
      .notNull()
      .references(() => users.id),
    peer_id: char('peer_id', { length: 26 }).references(() => peerAgents.id),
    action: varchar('action', { length: 64 }).notNull(),
    scope_json: jsonb('scope_json').notNull(),
    level: varchar('level', { length: 8 }).notNull(),
    decision: varchar('decision', { length: 16 }),
    decision_scope: varchar('decision_scope', { length: 16 }),
    requested_by: char('requested_by', { length: 26 }),
    decided_by: char('decided_by', { length: 26 }),
    expires_at: timestamp('expires_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    decided_at: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [index('idx_permissions_user_peer').on(t.user_id, t.peer_id)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: char('id', { length: 26 }).primaryKey(),
    user_id: char('user_id', { length: 26 })
      .notNull()
      .references(() => users.id),
    device_id: varchar('device_id', { length: 64 }).notNull(),
    platform: varchar('platform', { length: 16 }),
    refresh_token_hash: text('refresh_token_hash'),
    last_active_at: timestamp('last_active_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('idx_sessions_user').on(t.user_id)],
);

export const attachments = pgTable('attachments', {
  id: char('id', { length: 26 }).primaryKey(),
  message_id: char('message_id', { length: 26 }).references(() => messages.id),
  user_id: char('user_id', { length: 26 })
    .notNull()
    .references(() => users.id),
  filename: varchar('filename', { length: 255 }).notNull(),
  content_type: varchar('content_type', { length: 128 }),
  size_bytes: integer('size_bytes'),
  storage_url: text('storage_url').notNull(),
  sha256: char('sha256', { length: 64 }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: char('id', { length: 26 }).primaryKey(),
    user_id: char('user_id', { length: 26 }),
    action: varchar('action', { length: 64 }).notNull(),
    details_json: jsonb('details_json'),
    ip_address: inet('ip_address'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_audit_user_created').on(t.user_id, t.created_at)],
);

export const threads = pgTable(
  'threads',
  {
    id: char('id', { length: 26 }).primaryKey(),
    conversation_id: char('conversation_id', { length: 26 })
      .notNull()
      .references(() => conversations.id),
    root_message_id: char('root_message_id', { length: 26 })
      .notNull()
      .references(() => messages.id),
    title: varchar('title', { length: 255 }),
    summary: text('summary'),
    tags: text('tags').array(),
    participants_json: jsonb('participants_json'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closed_at: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [index('idx_threads_conversation').on(t.conversation_id)],
);

export const keypairs = pgTable(
  'keypairs',
  {
    id: char('id', { length: 26 }).primaryKey(),
    owner_type: varchar('owner_type', { length: 16 }).notNull(),
    owner_id: char('owner_id', { length: 26 }).notNull(),
    key_id: varchar('key_id', { length: 255 }).notNull().unique(),
    public_key_multibase: text('public_key_multibase').notNull(),
    private_key_jwk_encrypted: jsonb('private_key_jwk_encrypted').notNull(),
    algorithm: varchar('algorithm', { length: 32 }).notNull().default('Ed25519'),
    is_active: boolean('is_active').notNull().default(true),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('idx_keypairs_owner').on(t.owner_type, t.owner_id)],
);

export const projectMemory = pgTable(
  'project_memory',
  {
    id: char('id', { length: 26 }).primaryKey(),
    user_id: char('user_id', { length: 26 })
      .notNull()
      .references(() => users.id),
    project_id: varchar('project_id', { length: 255 }).notNull(),
    peer_id: char('peer_id', { length: 26 })
      .notNull()
      .references(() => peerAgents.id),
    facts_md: text('facts_md'),
    decisions_md: text('decisions_md'),
    meta_json: jsonb('meta_json'),
    version: integer('version').notNull().default(1),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_project_memory').on(t.user_id, t.project_id, t.peer_id),
    index('idx_project_memory_user_project').on(t.user_id, t.project_id),
  ],
);

export const agentMemories = pgTable(
  'agent_memories',
  {
    id: char('id', { length: 26 }).primaryKey(),
    user_id: char('user_id', { length: 26 })
      .notNull()
      .references(() => users.id),
    title: varchar('title', { length: 255 }).notNull(),
    content: text('content').notNull(),
    tags: text('tags').array().default([]),
    pinned: boolean('pinned').notNull().default(false),
    source: varchar('source', { length: 16 }).notNull().default('manual'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_agent_memories_user').on(t.user_id)],
);

export const knowledgeBases = pgTable(
  'knowledge_bases',
  {
    id: char('id', { length: 26 }).primaryKey(),
    user_id: char('user_id', { length: 26 })
      .notNull()
      .references(() => users.id),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_knowledge_bases_user').on(t.user_id)],
);

export const knowledgeDocuments = pgTable(
  'knowledge_documents',
  {
    id: char('id', { length: 26 }).primaryKey(),
    kb_id: char('kb_id', { length: 26 })
      .notNull()
      .references(() => knowledgeBases.id),
    user_id: char('user_id', { length: 26 })
      .notNull()
      .references(() => users.id),
    filename: varchar('filename', { length: 255 }).notNull(),
    content_type: varchar('content_type', { length: 128 }),
    size_bytes: integer('size_bytes'),
    chunk_count: integer('chunk_count').default(0),
    status: varchar('status', { length: 32 }).default('processing'),
    storage_key: varchar('storage_key', { length: 512 }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_knowledge_documents_kb').on(t.kb_id)],
);

// Global instance configuration as a typed key/value store. Values are stored as
// TEXT; the typed accessor (lib/app-config.ts) parses each known key and falls
// back to a code-level default when the row is absent. Empty table is fully
// backward compatible — every read resolves to its default.
export const appConfig = pgTable('app_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Idea C — MCP↔A2A bridge probe instrumentation. One row per `ask_person_agent`
// call: who asked, the question text (verification needs it; never logged), and
// the signals used to compute the unprompted active-use rate. The answer is
// relayed back through a placeholder conversation (`conversation_id`) by a human
// Wizard. `is_founder_test` lets the experiment lead audit-exclude founder
// dual-account self-tests from all success counts (NON-FOUNDER GATE).
export const probeAsks = pgTable(
  'probe_asks',
  {
    id: char('id', { length: 26 }).primaryKey(),
    asker_user_id: char('asker_user_id', { length: 26 })
      .notNull()
      .references(() => users.id),
    // Free text — the MVP deliberately does not resolve this to a peer agent.
    person: varchar('person', { length: 255 }).notNull(),
    // Stored for verification; truncated to 4000 chars in the route, never logged.
    question: text('question').notNull(),
    // Placeholder conversation the Wizard fills the answer into (retrieved via
    // the existing consult reply path). Created with the row.
    conversation_id: char('conversation_id', { length: 26 }).references(() => conversations.id),
    // Wizard's after-the-fact judgment: could the host model have answered itself?
    could_self_answer: boolean('could_self_answer'),
    // Whether a Slack-DM alternative was available at call time.
    had_slack_dm_alt: boolean('had_slack_dm_alt').notNull().default(false),
    // Whether this call was prompted (vs unprompted) — drives the unprompted rate.
    prompted: boolean('prompted').notNull().default(false),
    // Audit flag to exclude founder dual-account self-tests from success counts.
    is_founder_test: boolean('is_founder_test').notNull().default(false),
    filled_at: timestamp('filled_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_probe_asks_asker').on(t.asker_user_id)],
);

// Idea A — outbound delegate-assistant errand. A chore the owner delegates; a WoZ
// operator runs the back-and-forth and pushes decision cards. This is the
// OUTBOUND direction (the owner's own agent pauses to ask the owner) and is fully
// separate from the inbound connection-consent `permissions` table.
export const errands = pgTable(
  'errands',
  {
    id: char('id', { length: 26 }).primaryKey(),
    owner_user_id: char('owner_user_id', { length: 26 })
      .notNull()
      .references(() => users.id),
    title: varchar('title', { length: 255 }).notNull(),
    // Free-text chore type (A-EXP1 high-frequency categories surface here later).
    kind: varchar('kind', { length: 64 }),
    status: varchar('status', { length: 16 }).notNull().default('in_progress'),
    // Optional chat thread the errand was handed off through (for write-back).
    conversation_id: char('conversation_id', { length: 26 }).references(() => conversations.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completed_at: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('idx_errands_owner').on(t.owner_user_id)],
);

// A decision card on an errand: approve / change_price / info. The owner decides
// approve / change_price / reject. Prices are integer cents in a single currency.
// The card's scope is the single owning errand (the FK is the scope boundary).
export const errandCards = pgTable(
  'errand_cards',
  {
    id: char('id', { length: 26 }).primaryKey(),
    errand_id: char('errand_id', { length: 26 })
      .notNull()
      .references(() => errands.id),
    kind: varchar('kind', { length: 32 }).notNull(),
    summary: text('summary').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    // Integer cents — never floats. delta may be negative (a discount).
    base_price_cents: integer('base_price_cents'),
    price_delta_cents: integer('price_delta_cents'),
    strictly_necessary: boolean('strictly_necessary').notNull().default(true),
    // 'pending' until the owner decides: approve / change_price / reject.
    decision: varchar('decision', { length: 16 }).notNull().default('pending'),
    // Owner's counter price (change_price decision), integer cents.
    new_price_cents: integer('new_price_cents'),
    // Past this instant the card can no longer be decided (decide returns 409).
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    decided_at: timestamp('decided_at', { withTimezone: true }),
    decided_by: char('decided_by', { length: 26 }).references(() => users.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_errand_cards_errand').on(t.errand_id)],
);
