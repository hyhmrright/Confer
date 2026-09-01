# Confer — ডেটা মডেল

PostgreSQL-এর টেবিল কাঠামো ও TypeScript-এর টাইপ সংজ্ঞা। সব ID হলো ULID (সময়ের ক্রমে সাজানো, URL-নিরাপদ)।

## নামকরণের রীতি

- টেবিলের নাম: ছোট হাতের অক্ষর, আন্ডারস্কোর, বহুবচন (`users`, `peer_agents`)
- ফিল্ডের নাম: ছোট হাতের অক্ষর ও আন্ডারস্কোর
- প্রাইমারি কী: `id` (ULID)
- ফরেন কী: `{table}_id`
- টাইমস্ট্যাম্প: `created_at`, `updated_at`, `deleted_at` (সফট ডিলিট)
- JSON ফিল্ড: `*_json`

## মূল সত্তা

### users

এই ইনস্ট্যান্সে নিবন্ধিত ব্যবহারকারীরা।

```sql
CREATE TABLE users (
  id           CHAR(26) PRIMARY KEY,
  username     VARCHAR(64) UNIQUE NOT NULL,
  email        VARCHAR(255) UNIQUE,
  phone        VARCHAR(32) UNIQUE,
  display_name VARCHAR(128),
  avatar_url   TEXT,

  did          VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT,

  preferences_json JSONB DEFAULT '{}',
  llm_keys_json    JSONB DEFAULT '{}',

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ
);

CREATE INDEX idx_users_did ON users (did);
```

```typescript
interface User {
  id: string;
  username: string;
  email?: string;
  phone?: string;
  display_name?: string;
  avatar_url?: string;
  did: string;
  preferences: UserPreferences;
  llm_keys: LLMKeys;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
}

interface UserPreferences {
  language: 'zh' | 'en' | 'ja' | 'de' | string;
  timezone: string;
  notification: { push: boolean; email: boolean };
  privacy: { allow_offline_response: boolean };
}

// কী-গুলো হলো `shared/src/llm/catalog.ts`-এ থাকা সরবরাহকারীর id (এখন ১৮টি),
// সঙ্গে টুল সরবরাহকারী (`tavily`)। এখানে ইচ্ছে করেই সেগুলো গোনা হয়নি: একবার
// গোনা হয়েছিল, তারপর তালিকাটি openai / anthropic / deepseek / qwen-এ থেমে
// গিয়ে আর কখনও হালনাগাদ হয়নি। সরবরাহকারী এক জায়গাতেই থাকে — ক্যাটালগে।
//
// মানগুলো AES-256-GCM দিয়ে এনক্রিপ্ট করা (`ENCRYPTION_KEY`); কেবল গেটওয়ের
// ভিতরেই ডিক্রিপ্ট হয়, কোনো অবস্থাতেই ক্লায়েন্টে পাঠানো হয় না।
type LLMKeys = Record<string, EncryptedKey>;
```

### agents

প্রতিটি ব্যবহারকারীর Agent-এর বিন্যাস। এখন একজন ব্যবহারকারীর একটিই মূল Agent থাকে (v1); পরে একাধিক সম্ভব হবে।

```sql
CREATE TABLE agents (
  id              CHAR(26) PRIMARY KEY,
  user_id         CHAR(26) NOT NULL REFERENCES users(id),
  did             VARCHAR(255) NOT NULL UNIQUE,

  name            VARCHAR(128),
  description     TEXT,
  avatar_url      TEXT,

  primary_language VARCHAR(8) NOT NULL DEFAULT 'zh',
  style           VARCHAR(32) DEFAULT 'friendly',

  model_config_json    JSONB DEFAULT '{}',
  policies_json        JSONB DEFAULT '{}',
  capabilities_json    JSONB DEFAULT '[]',

  is_public       BOOLEAN NOT NULL DEFAULT false,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agents_user ON agents (user_id);
CREATE INDEX idx_agents_did ON agents (did);
```

```typescript
interface Agent {
  id: string;
  user_id: string;
  did: string;
  name?: string;
  description?: string;
  avatar_url?: string;
  primary_language: string;
  style: 'formal' | 'friendly' | 'technical' | 'casual';
  model_config: ModelConfig;
  policies: PolicyConfig;
  capabilities: Capability[];
  is_public: boolean;
}

interface ModelConfig {
  brain: ModelChoice;
  quick: ModelChoice;
  translation: ModelChoice;
  summarize: ModelChoice;
}

interface ModelChoice {
  provider: string; // catalog.ts-এর সরবরাহকারী id; এখানেও তালিকা দেওয়া হয়নি
  model: string;    // সরবরাহকারীর নিজের /models থেকে আসে, স্থানীয়ভাবে রাখা হয় না
  temperature?: number;
}

interface PolicyConfig {
  default: 'auto' | 'ask' | 'deny';
  rules: PolicyRule[];
}

interface PolicyRule {
  peer?: string;
  action: 'read' | 'ask' | 'share' | 'commit';
  pattern?: string;
  effect: 'allow' | 'deny' | 'ask';
}

interface Capability {
  type: 'qa' | 'code-generation' | 'translation' | string;
  scope: string[];
  languages: string[];
}
```

### peer_agents

যেসব ভিন্ন Agent আমরা ইতিমধ্যে চিনি (পরিচিতজন)। তারা এই ইনস্ট্যান্সের অন্য ব্যবহারকারীর হতে পারে, কিংবা অন্য কোনো ইনস্ট্যান্সের।

```sql
CREATE TABLE peer_agents (
  id              CHAR(26) PRIMARY KEY,
  did             VARCHAR(255) NOT NULL UNIQUE,

  name            VARCHAR(128),
  description     TEXT,
  avatar_url      TEXT,
  organization    VARCHAR(255),

  endpoint        TEXT NOT NULL,
  public_key_json JSONB NOT NULL,
  agent_facts_json JSONB NOT NULL,

  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  etag            VARCHAR(255),

  trust_level     VARCHAR(16) DEFAULT 'unknown',

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_peers_did ON peer_agents (did);
```

### peer_contacts

একজন ব্যবহারকারী আর একটি ভিন্ন Agent-এর মধ্যেকার সম্পর্ক ("আমার পরিচিতজন")।

```sql
CREATE TABLE peer_contacts (
  id            CHAR(26) PRIMARY KEY,
  user_id       CHAR(26) NOT NULL REFERENCES users(id),
  peer_id       CHAR(26) NOT NULL REFERENCES peer_agents(id),

  alias         VARCHAR(128),
  tags          TEXT[],
  pinned        BOOLEAN DEFAULT false,
  muted         BOOLEAN DEFAULT false,

  policy_overrides_json JSONB DEFAULT '{}',

  added_via     VARCHAR(32),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, peer_id)
);

CREATE INDEX idx_contacts_user ON peer_contacts (user_id);
```

### conversations

কথোপকথন। এক-এক হতে পারে (ব্যবহারকারী↔Agent, ব্যবহারকারী↔ব্যবহারকারী, Agent↔Agent), কিংবা দলগত।

```sql
CREATE TABLE conversations (
  id              CHAR(26) PRIMARY KEY,
  type            VARCHAR(16) NOT NULL,
  name            VARCHAR(255),

  created_by      CHAR(26) NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at     TIMESTAMPTZ
);

CREATE INDEX idx_conversations_created_by ON conversations (created_by);
```

`type`: `direct_user_agent` | `direct_user_user` | `direct_agent_agent` | `group`

### conversation_participants

অংশগ্রহণকারীরা। ব্যবহারকারী ও Agent — দুজনেই এখানে অংশগ্রহণকারী হিসেবে আসে।

```sql
CREATE TABLE conversation_participants (
  id               CHAR(26) PRIMARY KEY,
  conversation_id  CHAR(26) NOT NULL REFERENCES conversations(id),

  participant_type VARCHAR(16) NOT NULL,
  user_id          CHAR(26) REFERENCES users(id),
  agent_id         CHAR(26) REFERENCES agents(id),
  peer_id          CHAR(26) REFERENCES peer_agents(id),

  role             VARCHAR(16) DEFAULT 'member',
  joined_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at     TIMESTAMPTZ,
  notification     VARCHAR(16) DEFAULT 'all'
);

CREATE INDEX idx_participants_conv ON conversation_participants (conversation_id);
CREATE INDEX idx_participants_user ON conversation_participants (user_id);
```

`participant_type`: `user` | `own_agent` | `peer_agent`
`role`: `member` | `admin` | `observer`

### messages

```sql
CREATE TABLE messages (
  id               CHAR(26) PRIMARY KEY,
  conversation_id  CHAR(26) NOT NULL REFERENCES conversations(id),

  sender_type      VARCHAR(16) NOT NULL,
  sender_id        CHAR(26) NOT NULL,
  sender_did       VARCHAR(255),

  content_type     VARCHAR(32) NOT NULL DEFAULT 'text',
  content          TEXT,
  content_json     JSONB,

  in_reply_to      CHAR(26) REFERENCES messages(id),
  thread_root      CHAR(26) REFERENCES messages(id),

  citations_json   JSONB,
  language         VARCHAR(8),
  translation_json JSONB,

  via              VARCHAR(32),

  delivered_at     TIMESTAMPTZ,
  read_by_json     JSONB DEFAULT '[]',

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);

CREATE INDEX idx_messages_conversation_created ON messages (conversation_id, created_at DESC);
CREATE INDEX idx_messages_thread_root ON messages (thread_root) WHERE thread_root IS NOT NULL;
```

`sender_type`: `user` | `own_agent` | `peer_agent` | `system`
`content_type`: `text` | `code` | `permission_request` | `tool_call` | `tool_result` | `file` | `citation` | `system_notice`

```typescript
interface Message {
  id: string;
  conversation_id: string;
  sender_type: 'user' | 'own_agent' | 'peer_agent' | 'system';
  sender_id: string;
  sender_did?: string;
  content_type: ContentType;
  content?: string;
  content_json?: any;
  in_reply_to?: string;
  thread_root?: string;
  citations?: Citation[];
  language?: string;
  translation?: { from: string; to: string; provider: string };
  via?: 'claude-code' | 'web' | 'mobile' | 'api';
  created_at: Date;
}

interface Citation {
  source: string;
  url?: string;
  page?: number;
  passage?: string;
  trust_level: 'authoritative' | 'verified' | 'unverified';
}
```

### permissions

L2 / L3 অনুমতির অনুরোধ ও সিদ্ধান্তের নিরীক্ষা-নথি।

```sql
CREATE TABLE permissions (
  id              CHAR(26) PRIMARY KEY,
  user_id         CHAR(26) NOT NULL REFERENCES users(id),
  peer_id         CHAR(26) REFERENCES peer_agents(id),

  action          VARCHAR(64) NOT NULL,
  scope_json      JSONB NOT NULL,

  level           VARCHAR(8) NOT NULL,
  decision        VARCHAR(16),
  decision_scope  VARCHAR(16),

  requested_by    CHAR(26),
  decided_by      CHAR(26),

  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at      TIMESTAMPTZ
);

CREATE INDEX idx_permissions_user_peer ON permissions (user_id, peer_id);
```

`level`: `L1` | `L2` | `L3`
`decision`: `allow_once` | `allow_always` | `deny` | `pending`
`decision_scope`: `peer` | `peer_action` | `global`

### project_memory

`.claude/peers/`-এর সার্ভার-পাশের প্রতিরূপ। বিস্তারিত `docs/07-project-memory.md`-এ।

```sql
CREATE TABLE project_memory (
  id              CHAR(26) PRIMARY KEY,
  user_id         CHAR(26) NOT NULL REFERENCES users(id),
  project_id      VARCHAR(255) NOT NULL,
  peer_id         CHAR(26) NOT NULL REFERENCES peer_agents(id),

  facts_md        TEXT,
  decisions_md    TEXT,
  meta_json       JSONB,

  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, project_id, peer_id)
);

CREATE INDEX idx_project_memory_user_project ON project_memory (user_id, project_id);
```

### threads

দীর্ঘ আলোচনার সংরক্ষণ। একগুচ্ছ বার্তা যখন "এমন একটি নকশা-সিদ্ধান্ত হয়ে ওঠে যার উল্লেখ করা হয়েছে", তখন সেটিকে থ্রেড হিসেবে চিহ্নিত করে রেখে দেওয়া হয়।

```sql
CREATE TABLE threads (
  id              CHAR(26) PRIMARY KEY,
  conversation_id CHAR(26) NOT NULL REFERENCES conversations(id),
  root_message_id CHAR(26) NOT NULL REFERENCES messages(id),

  title           VARCHAR(255),
  summary         TEXT,
  tags            TEXT[],

  participants_json JSONB,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at       TIMESTAMPTZ
);

CREATE INDEX idx_threads_conversation ON threads (conversation_id);
```

## সহায়ক টেবিল

### sessions

ব্যবহারকারীদের লগইন সেশন।

```sql
CREATE TABLE sessions (
  id              CHAR(26) PRIMARY KEY,
  user_id         CHAR(26) NOT NULL REFERENCES users(id),
  device_id       VARCHAR(64) NOT NULL,
  platform        VARCHAR(16),
  refresh_token_hash TEXT,
  last_active_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions (user_id);
```

### attachments

```sql
CREATE TABLE attachments (
  id              CHAR(26) PRIMARY KEY,
  message_id      CHAR(26) REFERENCES messages(id),
  user_id         CHAR(26) NOT NULL REFERENCES users(id),

  filename        VARCHAR(255) NOT NULL,
  content_type    VARCHAR(128),
  size_bytes      BIGINT,
  storage_url     TEXT NOT NULL,
  sha256          CHAR(64),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### audit_log

A2A ট্র্যাফিক ও গুরুত্বপূর্ণ কাজের নিরীক্ষা।

```sql
CREATE TABLE audit_log (
  id              CHAR(26) PRIMARY KEY,
  user_id         CHAR(26),
  action          VARCHAR(64) NOT NULL,
  details_json    JSONB,
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_user_created ON audit_log (user_id, created_at DESC);
```

## Redis কী-এর রীতি

> নিচের দুটি অংশ অনুভূমিক সম্প্রসারণের জন্য ভাবা নকশা। **Redis আর NATS আজ
> মোতায়েনও নেই, কোথাও যুক্তও নেই** (২০২৬-০৮-০৭-এ `docker-compose*.yml` ও
> `env.ts` থেকে সরানো হয়েছে)। উপরের টেবিলগুলো সত্যি আছে; এই দুটি অংশ নেই —
> দেখুন `docs/02-architecture.md`-এর শুরুর টীকা।

```
session:{token_jti}                # সেশনের তথ্য, TTL = টোকেনের exp
presence:{user_id}                 # অনলাইন অবস্থা; SET-এ সক্রিয় device_id থাকে
ratelimit:user:{user_id}:{route}   # স্লাইডিং উইন্ডো
ratelimit:peer:{peer_domain}       # peer-ভিত্তিক হার-সীমা
did_cache:{did}                    # DID নথি, TTL ৬০ সেকেন্ড + ETag
agent_facts:{did}                  # AgentFacts-এর ক্যাশ
ws_conn:{user_id}                  # ব্যবহারকারীর সক্রিয় WS সংযোগের ID
typing:{conversation_id}           # এখন কে লিখছে
unread:{user_id}:{conversation_id} # অপঠিতের গণনা
```

## NATS subjects

```
user.{user_id}.events              # ব্যবহারকারীর সব ঘটনা (গেটওয়ে সাবস্ক্রাইব করে fan-out করে)
agent.{agent_id}.tasks             # Agent runtime-এর কাজের সারি
conversation.{conv_id}.messages    # কথোপকথনের ভিতরে বার্তার সম্প্রচার
a2a.outbound                       # বাইরে যাওয়া A2A অনুরোধের সারি
a2a.inbound                        # ভিতরে আসা A2A অনুরোধের সারি
```
