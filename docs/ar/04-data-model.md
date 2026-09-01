# Confer — نموذج البيانات

بنية جداول PostgreSQL وتعريفات أنواع TypeScript. جميع المعرّفات من نوع ULID (مرتّبة زمنيًا وآمنة في العناوين).

## اصطلاحات التسمية

- أسماء الجداول: حروف صغيرة وشرطات سفلية وصيغة الجمع (`users`، `peer_agents`)
- أسماء الحقول: حروف صغيرة مع شرطات سفلية
- المفتاح الأساسي: `id` (ULID)
- المفاتيح الأجنبية: `{table}_id`
- الطوابع الزمنية: `created_at` و`updated_at` و`deleted_at` (حذف ناعم)
- حقول JSON: `*_json`

## الكيانات الأساسية

### users

المستخدمون المسجَّلون على هذه النسخة.

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

// المفاتيح هي معرّفات المزوّدين الموجودة في `shared/src/llm/catalog.ts`
// (ثمانية عشر اليوم)، إضافة إلى مزوّدي الأدوات (`tavily`). لم تُعدَّد هنا
// عن قصد: عُدِّدت مرة واحدة، ثم توقفت القائمة عند openai / anthropic /
// deepseek / qwen ولم تلحق بالركب بعدها أبدًا. المزوّد يظهر مرة واحدة فقط،
// في الفهرس.
//
// القيم نصّ مشفَّر بخوارزمية AES-256-GCM (`ENCRYPTION_KEY`)، ولا يُفكّ
// تشفيرها إلا داخل البوابة، ولا تُرسَل إلى العميل بأي حال.
type LLMKeys = Record<string, EncryptedKey>;
```

### agents

إعدادات وكيل كل مستخدم. للمستخدم اليوم وكيل رئيسي واحد (النسخة v1)، وقد يصير للمستخدم عدة وكلاء لاحقًا.

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
  provider: string; // معرّف المزوّد من catalog.ts، ولا تُعدَّد المزوّدون هنا كذلك
  model: string;    // يأتي من مسار /models الخاص بالمزوّد، ولا يُحفظ محليًا
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

وكلاء الطرف الآخر الذين نعرفهم مسبقًا (جهات الاتصال). قد يكونون لمستخدم آخر على هذه النسخة، أو على نسخة أخرى.

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

العلاقة بين المستخدم ووكيل الطرف الآخر («جهات اتصالي»).

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

المحادثات. قد تكون ثنائية (مستخدم↔وكيل، مستخدم↔مستخدم، وكيل↔وكيل) أو جماعية.

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

المشاركون. يظهر المستخدمون والوكلاء معًا بوصفهم مشاركين.

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

سجلّ تدقيق لطلبات الأذونات من المستويين L2 و L3 وللقرارات المتّخذة بشأنها.

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

النسخة المرآة على الخادوم لمجلد `.claude/peers/`. للتفصيل انظر `docs/07-project-memory.md`.

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

أرشفة المواضيع الطويلة. حين تشكّل مجموعة من الرسائل «قرار تصميم سبق أن استُشهد به»، تُعلَّم بوصفها خيطًا وتُحفَظ.

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

## جداول مساعدة

### sessions

جلسات دخول المستخدمين.

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

تدقيق حركة A2A والعمليات المهمة.

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

## اصطلاحات مفاتيح Redis

> القسمان التاليان هما التصميم المقصود عند التوسّع الأفقي. **Redis وNATS اليوم
> غير منشورَين وغير موصولَين** (أُزيلا من `docker-compose*.yml` ومن `env.ts`
> بتاريخ 2026-08-07). الجداول أعلاه موجودة فعلًا، أما هذان القسمان فلا —
> انظر الملاحظة في صدر `docs/02-architecture.md`.

```
session:{token_jti}                # بيانات الجلسة، ومدة البقاء = صلاحية الرمز
presence:{user_id}                 # حالة الاتصال؛ تحتوي المجموعة على معرّفات الأجهزة النشطة
ratelimit:user:{user_id}:{route}   # نافذة منزلقة
ratelimit:peer:{peer_domain}       # تحديد معدّل لكل قرين
did_cache:{did}                    # مستند DID، مدة البقاء 60 ثانية + ETag
agent_facts:{did}                  # ذاكرة مؤقتة لـ AgentFacts
ws_conn:{user_id}                  # معرّفات اتصالات WS النشطة للمستخدم
typing:{conversation_id}           # من يكتب الآن
unread:{user_id}:{conversation_id} # عدد غير المقروء
```

## NATS subjects

```
user.{user_id}.events              # كل أحداث المستخدم (تشترك البوابة فيها لتوزيعها)
agent.{agent_id}.tasks             # طابور مهام Agent runtime
conversation.{conv_id}.messages    # بثّ الرسائل داخل المحادثة
a2a.outbound                       # طابور طلبات A2A الصادرة
a2a.inbound                        # طابور طلبات A2A الواردة
```
