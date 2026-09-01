# Confer — Память проекта (.claude/peers/)

Задаёт формат файлов, в которых знание оседает внутри проекта при интеграции с Claude Code. Это одно из главных изобретений Confer: **знание поставщика едет вместе с проектом и не теряется ни между сессиями, ни между людьми, ни между машинами**.

> **Статус (2026-09-01)**: этот документ описывает целевую форму. Сегодня работает **память проекта на стороне сервера**: инструменты MCP `read_project_memory` / `write_project_memory` хранят `facts` / `decisions` в таблице `project_memory` вашего собственного экземпляра (уникально по пользователь × проект × peer), по-прежнему в виде Markdown. Описанная ниже раскладка файлов `.claude/`, разбор `confer.toml` и автоматическое извлечение фактов ещё не реализованы; см. v0.2 в [`08-mvp-backlog.md`](./08-mvp-backlog.md).

## Структура каталогов

В корне каждого проекта:

```
.claude/
├── confer.toml                   # настройки проекта (пиры, уровни доверия)
└── peers/
    ├── abc-industries/
    │   ├── facts.md              # проверенные факты в структурированном виде
    │   ├── decisions.md          # запись проектных решений
    │   ├── conversations/        # полная история разговоров
    │   │   ├── 2024-11-15-modbus-setup.md
    │   │   └── 2024-11-20-temp-calibration.md
    │   ├── snippets/             # фрагменты кода
    │   │   └── read_temp.py
    │   └── meta.json             # метаданные пира
    └── internal-sdk/
        ├── facts.md
        └── ...
```

Едет вместе с git, и все соавторы им пользуются.

## Формат файлов

### `meta.json`

```json
{
  "peer": {
    "slug": "abc-industries",
    "did":  "did:web:acme.com:agents:support",
    "name": "ABC Industries Support",
    "endpoint": "https://acme.com/a2a/v1",
    "authority": ["X100", "X200", "Modbus", "RTU", "TCP"],
    "languages": ["en", "zh", "de"]
  },
  "trust": "high",
  "registered_at": "2024-11-01T10:00:00Z",
  "last_synced_at": "2024-11-15T14:30:00Z",
  "stats": {
    "total_queries": 47,
    "total_facts": 23,
    "total_decisions": 6
  }
}
```

### `facts.md`

Структурированный перечень фактов. **У каждого факта обязана быть ссылка на источник**: «факт» без источника — это галлюцинация.

```markdown
# ABC Industries facts (project: modbus-integration)

> Auto-maintained by Confer. Each entry is verified by ABC Industries Agent
> with primary source citation. Do not edit machine-generated entries directly;
> use `confer memory edit` to propose changes.

## Modbus register map (X100)

- `0x40-0x47`: Temperature, 4 channels, units of 0.1°C, int16 signed
- `0x48-0x4F`: Pressure, 4 channels, units of 0.01 MPa, uint16
- `0x50-0x57`: Reserved (do not write)
- Function code: **0x03** (Read Holding Registers) — recommended
- Byte order: big-endian (high byte first)
- Default slave ID: **0x0A (10)** — not 1 as docs imply
  - Source: Руководство по связи X100 v3.2 p.87
  - Source: Руководство по установке X100 p.12 (slave ID note)
  - Verified: 2024-11-15 via ask_peer

## Wiring (X100)

- Power: 24V DC ± 10%, max 500mA
- RS-485 termination: 120Ω at both ends
- Cable length max: 1200m at 9600 baud, 500m at 115200 baud
  - Source: Монтажное руководство X100 v3.2 p.45
  - Verified: 2024-11-15

## RTU mode timing

- Inter-character timeout: ≥ 1.5 character times
- Inter-frame timeout: ≥ 3.5 character times
- Recommended polling interval: 200ms or more
  - Source: Руководство по связи X100 v3.2 p.103
  - Note: 100ms works but no CRC retry budget left
  - Verified: 2024-11-15
```

Соглашения по формату:

- темы разделяются заголовками markdown второго уровня (`##`)
- каждый факт — элемент списка
- ключевые значения выделяются `**полужирным**`
- в конце каждой группы фактов обязательны строка `Source:` и отметка `Verified:`
- несколько источников записываются несколькими строками `Source:`

### `decisions.md`

Проектные решения, принятые в этом проекте и связанные с этим пиром. В отличие от facts (авторитетных выводов поставщика), decisions — это наш собственный выбор.

```markdown
# Decisions (project: modbus-integration, peer: abc-industries)

## D1: Use async polling at 200ms

**Date**: 2024-11-15
**Made by**: laowang (with consultation from ABC Agent)
**Status**: Active

We poll the X100 temperature/pressure registers every 200ms using async I/O.

**Alternatives considered:**
- 100ms polling — rejected: insufficient CRC retry budget
- Event-driven (X100 push) — not supported by this firmware

**Why this works for us**: 200ms latency is acceptable for our control loop;
async I/O lets us poll multiple devices concurrently.

**References:**
- See facts: "RTU mode timing"
- Conversation: 2024-11-15-modbus-setup.md
- Code: src/modbus/x100_client.py

---

## D2: Treat slave ID 10 as default; require explicit override

**Date**: 2024-11-15
**Made by**: laowang
**Status**: Active

After verification with ABC Agent that the documented "slave ID 1" is wrong
and actual default is 10, we hardcoded `DEFAULT_SLAVE_ID = 10` and require
explicit override via env variable for non-default installations.

**Why**: The vendor's docs and reality diverge. We trust verified vendor
statements over published docs.

**References:**
- See facts: "Modbus register map (X100)" → slave ID note
```

Соглашения по формату:

- у каждого решения свой уникальный идентификатор (`D1`, `D2`, …)
- обязательные поля: Date, Made by, Status
- Status: `Active` | `Superseded by D{n}` | `Deprecated`
- рассмотренные варианты обязательно перечисляются
- обязательны ссылки обратно на соответствующие facts и код

### `conversations/{date}-{slug}.md`

Полная история разговоров. Confer сам складывает сюда каждую ветку.

```markdown
---
thread_id: thread_8f3a9c
peer: did:web:acme.com:agents:support
date: 2024-11-15
participants: [laowang, abc-industries-agent]
via: claude-code
status: closed
tags: [modbus, registers, x100]
summary: |
  Confirmed register map for X100 temperature and pressure sensors.
  Clarified function code recommendation and slave ID default.
---

# Modbus setup conversation

## laowang
Нужно подключить X100 по Modbus: четыре канала температуры и четыре давления, с опросом.

## ABC Agent
Карта регистров Modbus RTU:
- 0x40–0x47 температура (4 канала)
- 0x48–0x4F давление (4 канала)
Советую период опроса 200 мс и код функции 0x03 для сплошного чтения.

📎 Source: Руководство по связи X100 v3.2 p.87

## laowang
Сплошное чтение не даст просадки? Ведомое устройство не подвиснет?

## ABC Agent
Чтение восьми регистров подряд — это один запрос, так что не подвиснет. Но учтите: slave ID по умолчанию 0x0A (10), а не 1; в старом руководстве ошибка.

📎 Source: Руководство по установке X100 p.12, FAQ #4
```

### Соглашения об именах файлов

- conversations: `{ISO date}-{kebab-slug}.md`
- snippets: называются по назначению, с расширением соответствующего языка

## Пути записи и чтения

### Путь записи

```
вызов ask_peer →
  облако Confer возвращает ответ →
  MCP-сервер извлекает структурированные факты →
  добавляет их в локальный facts.md (если факты новые)
  добавляет полный разговор в conversations/
  обновляет meta.json
  подсказка о коммите: предложить пользователю git add .claude/peers/{slug}/
```

### Путь чтения

```
запускается сессия Claude Code →
  обходится .claude/peers/*/ →
  facts.md каждого пира отдаётся Claude Code как часть системного запроса →
  Claude Code естественно ссылается на эти факты, когда пишет код
```

### Разбор противоречий

Если один и тот же факт проверяли несколько раз:

- побеждает самая поздняя проверка
- если новый результат противоречит старому, **перезаписи не происходит**: добавляется пометка `⚠️ Conflict:` и решение оставляется пользователю

Например:

```markdown
- Default slave ID: ~~0x01 (1)~~ **0x0A (10)**
  - Source: Руководство по связи X100 v3.2 p.12 (says 1)
  - Source: Руководство по установке X100 p.12 (says 10) ← latest verification
  - ⚠️ Conflict: Vendor's two docs disagree. Use 10 per latest verification.
  - Verified: 2024-11-15
```

## Синхронизация с сервером

Память проекта можно по желанию синхронизировать с сервером Confer (переключателем пользователя; по умолчанию локальное главнее):

```bash
confer sync push    # выгружает локальный .claude/peers/
confer sync pull    # забирает с сервера последнюю версию (случай командной работы)
```

На сервере она хранится в таблице `project_memory` (см. `docs/04-data-model.md`).

Почему по умолчанию главнее локальное:
- память проекта — чувствительные сведения (в ней внутренние решения)
- локального хранения достаточно, а согласование между людьми уже берёт на себя git
- сервер — это только резервная копия и удобство «почитать с другого устройства»

## Как выглядят ссылки на источники

Порождая код, Claude Code сам добавляет комментарии-ссылки к фактам, пришедшим из facts.md:

```python
# X100 register map: 0x40-0x47 temperature, 4 channels, int16 signed
# Source: Руководство по связи X100 v3.2 p.87 (verified 2024-11-15 via ABC Agent)
TEMP_REG_START = 0x40
TEMP_REG_COUNT = 8

# Default slave ID is 10 (not 1 as initial docs say)
# Source: .claude/peers/abc-industries/facts.md → D2 decision
DEFAULT_SLAVE_ID = 10
```

Так сам код несёт на себе доказательную цепочку «почему написано именно так».

## Приватность и безопасность

- `.claude/` по умолчанию должен оставаться вне `.gitignore` — то есть попадать в git
- но токены аутентификации, закрытые ключи и прочее чувствительное в `.claude/peers/` не пишутся никогда
- если в `.claude/confer.toml` есть токен, этот файл отдельно вносится в `.gitignore`
- если в истории разговоров попались секреты, они автоматически вымарываются с пометкой

## Критерии приёмки

- [ ] при запуске Claude Code правильно загружает как контекст все `.claude/peers/*/facts.md`
- [ ] после `ask_peer` facts.md обновляется меньше чем за секунду
- [ ] формат файла читается человеком и разбирается машиной (годится инструментам с обеих сторон)
- [ ] git-diff по markdown читается внятно (не как diff по JSON)
- [ ] выдерживает не менее 1000 фактов без потери быстродействия
