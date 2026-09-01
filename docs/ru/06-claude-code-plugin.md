# Confer — Устройство MCP-плагина для Claude Code

Сделать Confer MCP-сервером для Claude Code, чтобы Claude Code прямо во время работы над кодом мог обращаться к Агентам поставщиков и внутренних команд, а ответы оседали в проекте. **Это ключевая возможность Confer.**

## Принципы устройства

Речь не о том, чтобы «прицепить инструмент», а о том, чтобы дать Claude Code **команду предметных экспертов**. Каждому поставщику соответствует «эксперт» с долгой памятью, а знание оседает в проекте и не теряется между сессиями.

Пять опор замысла (стратегические подробности — в `docs/01-product.md`):

1. Vendor specialist subagent — постоянный предметный эксперт
2. Накопление знания на уровне проекта — `.claude/peers/`
3. Pre-flight design review — пройти через эксперта до того, как писать код
4. Post-flight code review — дать эксперту вычитать уже написанный код
5. Приоритет авторитета и прозрачность личности — в своей области суждение поставщика перевешивает суждение универсальной модели

## Установка

> Приведённые ниже `claude mcp add … @confer/mcp-server` и OAuth — это **целевой замысел**. Как на самом деле ставится v0.1, написано в конце этого раздела, в «Текущей реализации (v0.1)»: сегодня существует плагин `confer-a2a` с аутентификацией через переменные окружения.

```bash
# со стороны пользователя (замысел)
claude mcp add confer npx -y @confer/mcp-server

# при первом запуске проводит через OAuth и привязывает учётную запись Confer
claude mcp config confer
# выберите экземпляр: cloud.confer.ai или адрес своего
# OAuth уходит в браузер для аутентификации
```

Файл настроек (его правит пользователь):

```toml
# .claude/confer.toml

[instance]
url    = "https://cloud.confer.ai"
token  = "encrypted-by-keychain"

[defaults]
auto_consult = true               # автоматически обращаться, когда обнаружены ключевые слова
review_mode  = "post-flight"      # never | pre-flight | post-flight | both
language     = "ru"

[peer.abc-industries]
did       = "did:web:acme.com:agents:support"
authority = ["X100", "X200", "Modbus", "RTU", "TCP"]
trust     = "high"

[peer.internal-sdk]
did       = "did:web:mycompany.com:agents:sdk-team"
authority = ["powersupply-lib", "internal-bus", "auth-service"]
trust     = "high"
```

### Текущая реализация (v0.1)

OAuth и пакет npx из замысла ещё не сделаны. Что сделано — это **установка в один клик из каталога плагинов** с аутентификацией через переменные окружения (закрытый ключ подписи всегда остаётся в шлюзе и никуда не спускается):

```bash
# 1. добавьте каталог и поставьте плагин (этот репозиторий и есть каталог)
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer

# 2. выставьте учётную запись в оболочке (плагин читает её из окружения; учётные данные в репозиторий не попадают)
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
# необязательно: export CONFER_GATEWAY_URL=http://localhost:3000  (значение по умолчанию)
```

Плагин несёт самодостаточную сборку (`plugins/confer-a2a/dist/server.mjs`, запускается голым `node`, без монорепозитория и без `bun`), собранную из `packages/mcp-a2a` командой `bun run --filter @confer/mcp-a2a build:plugin`. Он даёт 15 инструментов (`list_agents` / `ask_agent` / `follow_up` / `ask_multiple` / `check_reply` и другие); подробности — в `plugins/confer-a2a/README.md` и `packages/mcp-a2a/README.md`.

Тот, кто работает внутри репозитория, может обойтись без плагина и взять корневой `.mcp.json` (он указывает на `server.ts` в исходниках) или `claude mcp add`.

## Предоставляемые инструменты MCP

### `ask_peer`

Задать вопрос чужому Агенту.

```typescript
{
  name: "ask_peer",
  description: "Ask a peer Agent a question. Use this when you need vendor-specific or domain-specific knowledge that may not be in your training data.",
  inputSchema: {
    type: "object",
    properties: {
      peer: { type: "string", description: "Peer slug (e.g. 'abc-industries') or DID" },
      question: { type: "string" },
      context: { type: "string", description: "Optional context: what we're trying to do" },
      thread_id: { type: "string", description: "Continue an existing conversation" }
    },
    required: ["peer", "question"]
  }
}
```

Возвращает:

```json
{
  "answer": "Кодом 0x03, Read Holding Registers…",
  "citations": [{"source": "Руководство по связи X100 v3.2", "page": 87}],
  "thread_id": "thread_8f3a9c",
  "peer_did": "did:web:acme.com:agents:support",
  "latency_ms": 4231
}
```

### `list_peers`

Перечислить доступных сейчас чужих Агентов.

```typescript
{
  name: "list_peers",
  description: "List peer Agents registered for this project, with their capabilities.",
  inputSchema: {
    type: "object",
    properties: {
      authority: { type: "string", description: "Filter by authority keyword (e.g. 'Modbus')" }
    }
  }
}
```

### `discover_peer`

Найти нового чужого Агента (поиск по домену).

```typescript
{
  name: "discover_peer",
  description: "Discover a peer Agent by domain or DID. Use this when the user mentions a vendor that's not yet registered.",
  inputSchema: {
    type: "object",
    properties: {
      domain: { type: "string", description: "e.g. 'abc-industries.com'" }
    },
    required: ["domain"]
  }
}
```

### `read_project_memory`

Прочитать знание, накопленное в этом проекте.

```typescript
{
  name: "read_project_memory",
  description: "Read accumulated facts and decisions for a peer in this project. Use this at the start of relevant tasks to load context.",
  inputSchema: {
    type: "object",
    properties: {
      peer: { type: "string" },
      section: { type: "string", enum: ["facts", "decisions", "conversations", "meta"] }
    },
    required: ["peer"]
  }
}
```

### `write_project_memory`

Записать знание проекта (обычно вызывается само после ask_peer, но можно и вручную).

```typescript
{
  name: "write_project_memory",
  description: "Write a verified fact or decision to project memory. Auto-called after ask_peer for important answers.",
  inputSchema: {
    type: "object",
    properties: {
      peer: { type: "string" },
      section: { type: "string", enum: ["facts", "decisions"] },
      key: { type: "string", description: "Short identifier" },
      content: { type: "string", description: "Markdown content" },
      citations: { type: "array", items: { type: "object" } }
    },
    required: ["peer", "section", "key", "content"]
  }
}
```

### `request_design_review`

Pre-flight: показать замысел эксперту.

```typescript
{
  name: "request_design_review",
  description: "Submit a design plan to a peer Agent for review before implementing. Strongly recommended for non-trivial vendor-specific work.",
  inputSchema: {
    type: "object",
    properties: {
      peer: { type: "string" },
      plan: { type: "string", description: "Markdown-formatted plan" },
      scope: { type: "string", description: "What part of the system" }
    },
    required: ["peer", "plan"]
  }
}
```

### `request_code_review`

Post-flight: дать эксперту вычитать написанный код.

```typescript
{
  name: "request_code_review",
  description: "Submit a code diff to a peer Agent for review after writing. Useful for catching vendor-specific gotchas.",
  inputSchema: {
    type: "object",
    properties: {
      peer: { type: "string" },
      files: { type: "array", items: { type: "object", properties: { path: {}, content: {} } } },
      focus: { type: "string", description: "What to focus on" }
    },
    required: ["peer", "files"]
  }
}
```

## Предоставляемые ресурсы MCP

Claude Code может ссылаться на них синтаксисом `@resource:…`.

### `confer://peers/{peer_slug}/facts`

Возвращает файл facts в формате markdown.

### `confer://peers/{peer_slug}/conversations/{thread_id}`

Возвращает полную запись одного разговора.

### `confer://threads/{thread_id}`

Возвращает как контекст разговор из мессенджера основной программы (пользователь может скопировать там адрес ветки и отдать его Claude Code).

## Предоставляемые prompts MCP

Готовые шаблоны запросов, которые пользователь может быстро вызвать.

### `consult-vendor`

```
"Help me design how to integrate {topic}. Before writing code,
consult the relevant vendor Agent via ask_peer, and load any
existing project memory."
```

### `verify-with-source`

```
"Review the current implementation in {file}. For each
vendor-specific decision, verify with the relevant peer Agent
and add citation comments where they're missing."
```

## Самостоятельное поведение

Когда Claude Code обращается к MCP-серверу Confer, сервер подсказывает ему, как вести себя разумнее:

### Признаки, по которым ask_peer вызывается сам

```toml
[auto_consult.triggers]
keywords_match_authority = true        # в коде или разговоре встретились слова из peer.authority
explicit_uncertainty     = true        # когда Claude Code говорит «I'm not sure»
import_vendor_lib        = true        # импортирован SDK какого-то поставщика
```

Как это устроено: MCP-сервер добавляет подсказку в описание инструмента — например, в конец описания `ask_peer`:

> "Strongly prefer calling this over guessing for any question about: X100, X200, Modbus, RTU, TCP, PowerSupply-lib (from registered peers' authority lists)."

Claude Code видит эту подсказку и сам решает вызвать инструмент.

### Автоматическая запись памяти проекта

После каждого удачного `ask_peer` MCP-сервер пробует структурно извлечь из ответа «факты» и записать их в `facts.md`:

```
[after ask_peer succeeds]
→ MCP server analyzes the answer
→ if it contains structured facts (numbers, addresses, codes), extract
→ append to .claude/peers/{peer_slug}/facts.md with citation
→ return enriched response to Claude Code
```

## Сквозная личность

Запрос A2A несёт метку `via: claude-code`:

```json
{
  "from": "did:web:cloud.confer.ai:users:laowang",
  "to":   "did:web:acme.com:agents:support",
  "context": {
    "via":        "claude-code",
    "project":    "modbus-integration",
    "intent":     "code-generation"
  },
  "message": { /* ... */ }
}
```

Агент на той стороне может подстроить стиль ответа по `context.via`:

- `via: claude-code` → структурированный ответ (блоки кода, JSON, внятные имена полей)
- `via: web` → ответ обычным языком, с бо́льшим объяснением и контекстом
- `via: mobile` → сжато, с выделенным главным, удобно читать на маленьком экране

Эта подсказка ни к чему не обязывает, и Агент на той стороне вправе её не заметить. Но лучше, чтобы её соблюдали все.

## Безопасность и доверие

### Слой разрешений

Вызов `ask_peer` из Claude Code через MCP по умолчанию относится к L1 (консультация только на чтение). А вот:

- `request_code_review` (передать код пиру) → L2, в первый раз спрашиваем пользователя
- `share_files` (передать каталог файлов) → L2
- `commit_on_behalf` (решить за пользователя) → L3, спрашиваем каждый раз

Запрос разрешения MCP-сервер передаёт в основную программу, та показывает карточку разрешения в интерфейсе мессенджера, пользователь решает, и результат возвращается в Claude Code, который продолжает работу.

### Слой доверия

- при `peer.{slug}.trust = "high"` ответ этого пира в пределах его области авторитета перевешивает общие знания Claude Code
- при `trust = "medium"` ссылка идёт как справочная, и Claude Code помечает её
- при `trust = "low"` или для только что добавленного непроверенного пира у пользователя всегда спрашивают подтверждение приведённого результата

### Темп и стоимость

Локальное ограничение частоты в MCP-сервере:

- не более 50 вызовов `ask_peer` к одному пиру в пределах одной сессии Claude Code
- при превышении накопленного лимита появляется вопрос «продолжаем?»
- показывается оценка стоимости каждого вызова (исходя из модели, которой пользуется Агент на той стороне)

## Команды CLI

Вспомогательные команды для оболочки:

```bash
# перечислить зарегистрированных пиров
confer peer list

# добавить пира
confer peer add abc-industries --did did:web:acme.com:agents:support
confer peer add abc-industries --domain acme.com    # сам сходит в well-known

# посмотреть память проекта
confer memory show abc-industries
confer memory show abc-industries --section facts

# спросить прямо из командной строки
confer ask abc-industries "Каков диапазон напряжения у X100 в режиме RTU?"

# синхронизировать память проекта с сервером Confer
confer sync push
confer sync pull
```

## Ключевые моменты реализации MCP-сервера

Технический набор:

- Bun + TypeScript
- `@modelcontextprotocol/sdk`
- локальный кэш на SQLite (чтобы не ходить на сервер каждый раз)
- токен хранится в Keychain / Credential Manager

Основные файлы:

```
packages/mcp-server/
├── src/
│   ├── index.ts              # точка входа MCP-сервера
│   ├── tools/
│   │   ├── ask-peer.ts
│   │   ├── list-peers.ts
│   │   ├── discover-peer.ts
│   │   ├── project-memory.ts
│   │   ├── design-review.ts
│   │   └── code-review.ts
│   ├── resources/
│   ├── prompts/
│   ├── client.ts             # клиент API Confer
│   ├── auth.ts               # поток OAuth
│   ├── cache.ts              # локальный кэш на SQLite
│   └── config.ts             # читает .claude/confer.toml
└── package.json
```

Пример точки входа:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import { tools } from "./tools";
import { resources } from "./resources";
import { prompts } from "./prompts";

const server = new Server(
  { name: "confer", version: "0.1.0" },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

tools.forEach((t) => server.setRequestHandler(t.schema, t.handler));
resources.forEach((r) => server.registerResource(r));
prompts.forEach((p) => server.registerPrompt(p));

const transport = new StdioServerTransport();
await server.connect(transport);
```

## Критерии приёмки (v1)

- [ ] `claude mcp add confer` ставит одной строкой
- [ ] первый запуск целиком проводит через настройку OAuth
- [ ] `ask_peer` укладывается в 10 секунд от начала до конца (включая время размышления модели)
- [ ] `read_project_memory` быстрее 100 мс (при попадании в локальный кэш)
- [ ] pre-flight-обзор заставляет Claude Code поправить замысел
- [ ] память проекта уезжает вместе с репозиторием после коммита в git
- [ ] доступен хотя бы один публичный Агент поставщика (для демонстрации: mock-vendor.confer.dev)

## Состояние реализации (v0.1)

Всё написанное выше — полный замысел. Первая живая версия, `packages/mcp-a2a`, уже замыкает главный круг: «спросить чужого агента».

**Архитектура (два слоя)**

- У шлюза появилась исходящая консультация A2A по инициативе пользователя (`/api/v1/consult/*`, см. `docs/05-api.md`). До этого у платформы был единственный путь отправки A2A — «входящее → автоматический ответ» — и ни одного исходящего маршрута, который начинал бы пользователь.
- `packages/mcp-a2a`: MCP-сервер поверх stdio, который входит в шлюз под личностью **одного настроенного пользователя Confer**, получает токен и выставляет возможность консультации в виде инструментов. Подпись по-прежнему происходит в шлюзе; закрытый ключ его не покидает.

**Реализованные инструменты (15)**

| Область | Инструменты |
|----|------|
| Поиск | `list_agents` / `get_agent_capabilities` / `find_agents` |
| Консультация | `ask_agent` (синхронное ожидание) / `follow_up` / `get_conversation` |
| Продвинутое | `ask_multiple` (параллельно, не более 5) / `check_reply` (забрать асинхронно) |
| Эксплуатация | `whoami` |
| Конкретный человек | `ask_person_agent` (спросить агента определённого человека; мастер подставляет данные) |
| Память проекта | `read_project_memory` (читает facts/decisions; отсутствие — это пусто, а не ошибка) / `write_project_memory` (пишет facts или decisions, не стирая друг друга, с увеличением `version`) |
| Поиск и рецензирование | `discover_peer` (находит пира по domain/did/username, сохраняет его и возвращает `peer_id`; **связь контакта при этом не создаётся** — сначала его нужно принять в контакты в основной программе, иначе любая последующая запись памяти или консультация получит `403`: это и есть ворота согласия) / `request_design_review` (попросить пира отрецензировать замысел) / `request_code_review` (попросить пира отрецензировать файлы) |

Параметр `project` у инструментов памяти можно не указывать; тогда берётся `projectId` из настроек MCP (переменная окружения `CONFER_PROJECT_ID`, по умолчанию — basename рабочего каталога).

**Подключение**

```jsonc
{
  "mcpServers": {
    "confer-a2a": {
      "command": "bun",
      "args": ["run", "packages/mcp-a2a/src/server.ts"],
      "env": {
        "CONFER_GATEWAY_URL": "http://localhost:3000",
        "CONFER_USERNAME": "${CONFER_USERNAME}",
        "CONFER_PASSWORD": "${CONFER_PASSWORD}",
        // необязательно: идентификатор, задающий область памяти проекта; по умолчанию — имя рабочего каталога
        "CONFER_PROJECT_ID": "${CONFER_PROJECT_ID}"
      }
    }
  }
}
```

**Расстояние до замысла (впереди)**: привязка по OAuth, долгая память vendor specialist и накопление в `.claude/peers/`, обзоры pre/post-flight и приоритет авторитета остаются в backlog. Сегодня личность — это один настроенный пользователь, ответы приходят длинным опросом, а ожидающие разрешения пока показываются как `pending`.
