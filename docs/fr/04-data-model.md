# Confer — Modèle de données

Schéma des tables PostgreSQL et définitions de types TypeScript. Tous les identifiants sont des ULID (triés par le temps, compatibles URL).

## Conventions de nommage

- Noms de table : minuscules, tirets bas, au pluriel (`users`, `peer_agents`)
- Noms de champ : minuscules avec tirets bas
- Clé primaire : `id` (ULID)
- Clés étrangères : `{table}_id`
- Horodatages : `created_at`, `updated_at`, `deleted_at` (suppression logique)
- Champs JSON : `*_json`

## Entités principales

### users

Les utilisateurs inscrits sur cette instance.

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

// Les clés sont les identifiants de fournisseur de `shared/src/llm/catalog.ts`
// (18 à ce jour), plus les fournisseurs d'outils (`tavily`). On ne les énumère
// délibérément pas ici : cela a été fait une fois, puis la liste s'est figée sur
// openai / anthropic / deepseek / qwen et n'a plus jamais suivi. Un fournisseur
// n'apparaît qu'une seule fois, dans le catalogue.
//
// Les valeurs sont chiffrées en AES-256-GCM (`ENCRYPTION_KEY`) ; elles ne sont
// déchiffrées que dans la passerelle et ne sont jamais transmises au client.
type LLMKeys = Record<string, EncryptedKey>;
```

### agents

La configuration de l'Agent de chaque utilisateur. Pour l'instant, un utilisateur n'a qu'un seul Agent principal (v1) ; plusieurs seront possibles plus tard.

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
  provider: string; // identifiant de fournisseur issu de catalog.ts, pas davantage énuméré ici
  model: string;    // renvoyé par le /models du fournisseur, jamais maintenu localement
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

Les Agents tiers que nous connaissons déjà (les contacts). Ils peuvent appartenir à un autre utilisateur de cette instance ou à une autre instance.

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

La relation entre un utilisateur et un Agent tiers (« mes contacts »).

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

Les conversations. En tête-à-tête (utilisateur↔Agent, utilisateur↔utilisateur, Agent↔Agent) ou en groupe.

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

Les participants. Les utilisateurs comme les Agents y figurent comme participants.

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

Journal d'audit des demandes et des décisions de permission L2 / L3.

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

Le miroir côté serveur de `.claude/peers/`. Voir `docs/07-project-memory.md`.

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

L'archivage des sujets longs. Lorsqu'un groupe de messages constitue « une décision de conception qui a été citée », il est marqué comme fil et conservé.

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

## Tables auxiliaires

### sessions

Les sessions de connexion des utilisateurs.

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

Audit du trafic A2A et des opérations importantes.

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

## Conventions de clés Redis

> Les deux sections qui suivent décrivent la conception prévue pour la montée en
> charge horizontale. **Redis et NATS ne sont aujourd'hui ni déployés ni câblés**
> (retirés de `docker-compose*.yml` et de `env.ts` le 2026-08-07). Les tables
> ci-dessus existent ; ces deux sections, non — voir la note en tête de
> `docs/02-architecture.md`.

```
session:{token_jti}                # données de session, TTL = exp du jeton
presence:{user_id}                 # statut en ligne ; le SET contient les device_id actifs
ratelimit:user:{user_id}:{route}   # fenêtre glissante
ratelimit:peer:{peer_domain}       # limitation de débit par pair
did_cache:{did}                    # document DID, TTL 60 s + ETag
agent_facts:{did}                  # cache AgentFacts
ws_conn:{user_id}                  # identifiants des connexions WS actives de l'utilisateur
typing:{conversation_id}           # qui est en train d'écrire
unread:{user_id}:{conversation_id} # compteur de non-lus
```

## NATS subjects

```
user.{user_id}.events              # tous les événements de l'utilisateur (la passerelle s'y abonne pour le fan-out)
agent.{agent_id}.tasks             # file de tâches de l'Agent runtime
conversation.{conv_id}.messages    # diffusion des messages au sein d'une conversation
a2a.outbound                       # file des requêtes A2A sortantes
a2a.inbound                        # file des requêtes A2A entrantes
```
