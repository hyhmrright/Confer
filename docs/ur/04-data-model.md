# Confer — ڈیٹا ماڈل

PostgreSQL کی جدولوں کی ساخت اور TypeScript کی ٹائپ تعریفیں۔ تمام ID، ULID ہیں (وقت کے اعتبار سے ترتیب یافتہ، URL کے لیے محفوظ)۔

## نام رکھنے کے اصول

- جدولوں کے نام: چھوٹے حروف، انڈر اسکور، جمع کی صورت (`users`، `peer_agents`)
- خانوں کے نام: چھوٹے حروف اور انڈر اسکور
- پرائمری کی: `id` (ULID)
- فارن کی: `{table}_id`
- وقت کی مہریں: `created_at`، `updated_at`، `deleted_at` (نرم حذف)
- JSON خانے: `*_json`

## بنیادی اکائیاں

### users

اس انسٹنس پر رجسٹرڈ صارفین۔

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

// کلیدیں `shared/src/llm/catalog.ts` میں موجود فراہم کنندگان کی id ہیں
// (اِس وقت اٹھارہ)، اور ساتھ ٹول فراہم کنندہ (`tavily`)۔ یہاں جان بوجھ کر
// انہیں گنوایا نہیں گیا: ایک بار گنوایا تھا، پھر فہرست openai / anthropic /
// deepseek / qwen پر رک گئی اور کبھی آگے نہ بڑھی۔ فراہم کنندہ صرف ایک جگہ
// آتا ہے — کیٹلاگ میں۔
//
// قدریں AES-256-GCM سے مشفّر ہیں (`ENCRYPTION_KEY`)؛ ان کی تشفیر کشائی
// صرف گیٹ وے کے اندر ہوتی ہے اور کسی حال میں کلائنٹ تک نہیں جاتیں۔
type LLMKeys = Record<string, EncryptedKey>;
```

### agents

ہر صارف کے Agent کی ترتیب۔ فی الحال ایک صارف کا ایک ہی بنیادی Agent ہوتا ہے (v1)؛ آگے کئی ہو سکیں گے۔

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
  provider: string; // catalog.ts کی فراہم کنندہ id؛ یہاں بھی انہیں نہیں گنوایا گیا
  model: string;    // فراہم کنندہ کے اپنے /models سے آتا ہے، مقامی طور پر نہیں رکھا جاتا
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

وہ دوسرے Agent جنہیں ہم پہلے سے جانتے ہیں (روابط)۔ وہ اسی انسٹنس کے کسی اور صارف کے ہو سکتے ہیں، یا کسی دوسرے انسٹنس کے۔

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

ایک صارف اور کسی دوسرے Agent کے درمیان تعلق ("میرے روابط")۔

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

گفتگو۔ یہ ایک سے ایک ہو سکتی ہے (صارف↔Agent، صارف↔صارف، Agent↔Agent) یا گروہی۔

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

شرکاء۔ صارف اور Agent دونوں یہاں شریک کے طور پر آتے ہیں۔

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

L2 / L3 اجازتوں کی درخواستوں اور فیصلوں کا آڈٹ ریکارڈ۔

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

`.claude/peers/` کا سرور پر عکس۔ تفصیل کے لیے `docs/07-project-memory.md` دیکھیں۔

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

طویل موضوعات کا محفوظ خانہ۔ جب پیغامات کا کوئی مجموعہ "ایسا ڈیزائن فیصلہ بن جائے جس کا حوالہ دیا جا چکا ہو"، تو اسے تھریڈ کے طور پر نشان زد کر کے محفوظ کر لیا جاتا ہے۔

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

## معاون جدولیں

### sessions

صارفین کے لاگ اِن سیشن۔

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

A2A ٹریفک اور اہم کارروائیوں کا آڈٹ۔

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

## Redis کلیدوں کے اصول

> نیچے کے دو حصے افقی توسیع کے لیے سوچا گیا ڈیزائن ہیں۔ **Redis اور NATS آج
> نہ تعینات ہیں، نہ کہیں جڑے ہوئے** (2026-08-07 کو `docker-compose*.yml` اور
> `env.ts` سے ہٹا دیے گئے)۔ اوپر کی جدولیں واقعی موجود ہیں؛ یہ دو حصے نہیں —
> `docs/02-architecture.md` کے آغاز کا نوٹ دیکھیں۔

```
session:{token_jti}                # سیشن کا ڈیٹا، TTL = ٹوکن کی exp
presence:{user_id}                 # آن لائن حالت؛ SET میں فعال device_id ہوتے ہیں
ratelimit:user:{user_id}:{route}   # سرکتی کھڑکی
ratelimit:peer:{peer_domain}       # peer کے حساب سے شرحِ حد
did_cache:{did}                    # DID دستاویز، TTL 60 سیکنڈ + ETag
agent_facts:{did}                  # AgentFacts کا کیش
ws_conn:{user_id}                  # صارف کے فعال WS کنکشن کی ID
typing:{conversation_id}           # اِس وقت کون لکھ رہا ہے
unread:{user_id}:{conversation_id} # اَن پڑھے کی گنتی
```

## NATS subjects

```
user.{user_id}.events              # صارف کے تمام واقعات (گیٹ وے سبسکرائب کر کے fan-out کرتا ہے)
agent.{agent_id}.tasks             # Agent runtime کی کاموں کی قطار
conversation.{conv_id}.messages    # گفتگو کے اندر پیغامات کی نشریات
a2a.outbound                       # باہر جانے والی A2A درخواستوں کی قطار
a2a.inbound                        # اندر آنے والی A2A درخواستوں کی قطار
```
