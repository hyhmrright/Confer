# Confer — डेटा मॉडल

PostgreSQL की टेबल संरचना और TypeScript के टाइप। सभी ID ULID हैं (समय के क्रम में, URL-सुरक्षित)।

## नामकरण के नियम

- टेबल के नाम: छोटे अक्षर, अंडरस्कोर, बहुवचन (`users`, `peer_agents`)
- फ़ील्ड के नाम: छोटे अक्षर और अंडरस्कोर
- प्राइमरी की: `id` (ULID)
- फ़ॉरेन की: `{table}_id`
- टाइमस्टैम्प: `created_at`, `updated_at`, `deleted_at` (सॉफ़्ट डिलीट)
- JSON फ़ील्ड: `*_json`

## मुख्य इकाइयाँ

### users

इस इंस्टेंस पर पंजीकृत उपयोगकर्ता।

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

// कुंजियाँ `shared/src/llm/catalog.ts` में मौजूद प्रदाता-id हैं (अभी 18) और
// साथ में टूल प्रदाता (`tavily`)। यहाँ उन्हें जानबूझकर गिनाया नहीं गया है:
// एक बार गिनाया था, और सूची openai / anthropic / deepseek / qwen पर ठहर गई
// और फिर कभी अद्यतन नहीं हुई। प्रदाता सिर्फ़ एक जगह आता है — कैटलॉग में।
//
// मान AES-256-GCM से एन्क्रिप्टेड हैं (`ENCRYPTION_KEY`); वे केवल गेटवे के
// भीतर ही डिक्रिप्ट होते हैं और किसी भी हाल में क्लाइंट तक नहीं जाते।
type LLMKeys = Record<string, EncryptedKey>;
```

### agents

हर उपयोगकर्ता के Agent का विन्यास। अभी एक उपयोगकर्ता के पास एक ही मुख्य Agent होता है (v1); आगे कई हो सकेंगे।

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
  provider: string; // catalog.ts का प्रदाता-id; यहाँ भी उन्हें गिनाया नहीं गया
  model: string;    // प्रदाता के अपने /models से आता है, स्थानीय रूप से नहीं रखा जाता
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

वे दूसरे Agent जिन्हें हम पहले से जानते हैं (संपर्क)। वे इसी इंस्टेंस के किसी और उपयोगकर्ता के हो सकते हैं, या किसी दूसरे इंस्टेंस के।

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

किसी उपयोगकर्ता और किसी दूसरे Agent के बीच का रिश्ता ("मेरे संपर्क")।

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

बातचीत। यह एक-से-एक हो सकती है (उपयोगकर्ता↔Agent, उपयोगकर्ता↔उपयोगकर्ता, Agent↔Agent) या समूह में।

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

भागीदार। उपयोगकर्ता और Agent — दोनों यहाँ भागीदार के रूप में आते हैं।

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

L2 / L3 अनुमति के अनुरोधों और निर्णयों का ऑडिट लॉग।

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

`.claude/peers/` की सर्वर-साइड प्रतिलिपि। विस्तार के लिए `docs/07-project-memory.md` देखें।

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

लंबे विषयों का संग्रह। जब संदेशों का कोई समूह "ऐसा डिज़ाइन-निर्णय बन जाए जिसका हवाला दिया गया हो", तो उसे थ्रेड के रूप में चिह्नित करके सहेज लिया जाता है।

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

## सहायक टेबल

### sessions

उपयोगकर्ताओं के लॉगिन सत्र।

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

A2A ट्रैफ़िक और महत्वपूर्ण कार्रवाइयों का ऑडिट।

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

## Redis कुंजियों के नियम

> नीचे के दो खंड क्षैतिज विस्तार के लिए सोचा गया डिज़ाइन हैं। **Redis और NATS
> आज न तैनात हैं और न कहीं जुड़े हुए** (2026-08-07 को `docker-compose*.yml` और
> `env.ts` से हटा दिए गए)। ऊपर की टेबलें सचमुच मौजूद हैं; ये दो खंड नहीं —
> देखें `docs/02-architecture.md` की शुरुआत में दी गई टिप्पणी।

```
session:{token_jti}                # सत्र का डेटा, TTL = टोकन का exp
presence:{user_id}                 # ऑनलाइन स्थिति; SET में सक्रिय device_id होते हैं
ratelimit:user:{user_id}:{route}   # स्लाइडिंग विंडो
ratelimit:peer:{peer_domain}       # peer पर दर-सीमा
did_cache:{did}                    # DID दस्तावेज़, TTL 60 सेकंड + ETag
agent_facts:{did}                  # AgentFacts का कैश
ws_conn:{user_id}                  # उपयोगकर्ता के सक्रिय WS कनेक्शन के ID
typing:{conversation_id}           # अभी कौन टाइप कर रहा है
unread:{user_id}:{conversation_id} # अपठित की गिनती
```

## NATS subjects

```
user.{user_id}.events              # उपयोगकर्ता की सारी घटनाएँ (गेटवे सदस्यता लेकर fan-out करता है)
agent.{agent_id}.tasks             # Agent runtime की कार्य-कतार
conversation.{conv_id}.messages    # बातचीत के भीतर संदेशों का प्रसारण
a2a.outbound                       # बाहर जाने वाले A2A अनुरोधों की कतार
a2a.inbound                        # भीतर आने वाले A2A अनुरोधों की कतार
```
