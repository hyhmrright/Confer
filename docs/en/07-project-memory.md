# Confer — Project memory (.claude/peers/)

Defines the file format for knowledge accumulated into a project under the Claude Code integration. This is one of Confer's core innovations: **let vendor knowledge travel with the project, never lost across sessions, developers, or devices**.

## Directory structure

Under each project root:

```
.claude/
├── confer.toml                   # 项目配置（peers, trust levels）
└── peers/
    ├── abc-industries/
    │   ├── facts.md              # 验证过的事实，结构化
    │   ├── decisions.md          # 设计决策记录
    │   ├── conversations/        # 完整对话历史
    │   │   ├── 2024-11-15-modbus-setup.md
    │   │   └── 2024-11-20-temp-calibration.md
    │   ├── snippets/             # 代码片段
    │   │   └── read_temp.py
    │   └── meta.json             # peer 元数据
    └── internal-sdk/
        ├── facts.md
        └── ...
```

Travels with git, shared by all collaborators.

## File format

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

A structured list of facts. **Every fact must carry a citation** — a "fact" without a citation is a hallucination.

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
  - Source: X100 通信手册 v3.2 p.87
  - Source: X100 安装指南 p.12 (slave ID note)
  - Verified: 2024-11-15 via ask_peer

## Wiring (X100)

- Power: 24V DC ± 10%, max 500mA
- RS-485 termination: 120Ω at both ends
- Cable length max: 1200m at 9600 baud, 500m at 115200 baud
  - Source: X100 安装手册 v3.2 p.45
  - Verified: 2024-11-15

## RTU mode timing

- Inter-character timeout: ≥ 1.5 character times
- Inter-frame timeout: ≥ 3.5 character times
- Recommended polling interval: 200ms or more
  - Source: X100 通信手册 v3.2 p.103
  - Note: 100ms works but no CRC retry budget left
  - Verified: 2024-11-15
```

Format conventions:

- Use markdown second-level headings (`##`) to split topics
- Each fact is a list item
- Highlight key values with `**bold**`
- The end of each fact group must have a `Source:` line plus a `Verified:` timestamp
- Multiple sources are supported via multiple `Source:` lines

### `decisions.md`

Design decisions made in the project that relate to this peer. Unlike facts (the vendor's authoritative conclusions), decisions are our own choices.

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

Format conventions:

- Every decision has a unique ID (`D1`, `D2`, ...)
- Required fields: Date, Made by, Status
- Status: `Active` | `Superseded by D{n}` | `Deprecated`
- Must list the alternatives considered
- Must link back to the related facts and code

### `conversations/{date}-{slug}.md`

Full conversation history. Confer automatically archives every thread here.

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
要给 X100 做 Modbus 集成，4 路温度 + 4 路压力，需要轮询。

## ABC Agent
Modbus RTU 寄存器映射：
- 0x40–0x47 温度（4 路）
- 0x48–0x4F 压力（4 路）
建议轮询周期 200ms，连续读用 0x03 功能码。

📎 Source: X100 通信手册 v3.2 p.87

## laowang
连续读会不会有性能问题？slave 设备会卡住吗？

## ABC Agent
连续读 8 个寄存器是单次请求，不会卡。但要注意 slave ID 默认是 0x0A (10)
不是 1，旧版手册有误。

📎 Source: X100 安装指南 p.12, FAQ #4
```

### File naming conventions

- conversations: `{ISO date}-{kebab-slug}.md`
- snippets: named by purpose, with the file extension matching the language

## Write and read flow

### Write path

```
ask_peer 调用 →
  Confer cloud 返回答案 →
  MCP server 抽取结构化事实 →
  追加到本地 facts.md（如果是新 fact）
  追加完整对话到 conversations/
  更新 meta.json
  本地 commit hint：建议用户 git add .claude/peers/{slug}/
```

### Read path

```
Claude Code session 启动 →
  扫描 .claude/peers/*/ →
  把每个 peer 的 facts.md 作为系统提示词的一部分喂给 Claude Code →
  Claude Code 在写代码时自然引用这些事实
```

### Conflict handling

If the same fact is verified multiple times:

- The most recent verification time wins
- If the new result contradicts the old one, **do not overwrite directly** — add a `⚠️ Conflict:` annotation and wait for the user to decide manually

For example:

```markdown
- Default slave ID: ~~0x01 (1)~~ **0x0A (10)**
  - Source: X100 通信手册 v3.2 p.12 (says 1)
  - Source: X100 安装指南 p.12 (says 10) ← latest verification
  - ⚠️ Conflict: Vendor's two docs disagree. Use 10 per latest verification.
  - Verified: 2024-11-15
```

## Syncing to the server

Optionally sync project memory to the Confer server (a user toggle, local-first by default):

```bash
confer sync push    # 把本地 .claude/peers/ 上传
confer sync pull    # 从服务端拉最新版本（团队协作场景）
```

The server stores it in the `project_memory` table (see `docs/04-data-model.md`).

Why local-first by default:
- Project memory is sensitive information (it includes the project's internal decisions)
- Local storage is sufficient; git already handles multi-person sync
- The server is just a convenience for backup and "cross-device reading"

## How citations are presented

When generating code, Claude Code automatically adds citation comments for facts drawn from facts.md:

```python
# X100 register map: 0x40-0x47 temperature, 4 channels, int16 signed
# Source: X100 通信手册 v3.2 p.87 (verified 2024-11-15 via ABC Agent)
TEMP_REG_START = 0x40
TEMP_REG_COUNT = 8

# Default slave ID is 10 (not 1 as initial docs say)
# Source: .claude/peers/abc-industries/facts.md → D2 decision
DEFAULT_SLAVE_ID = 10
```

This way the code itself carries a chain of evidence for "why it is written this way."

## Privacy and security

- By default `.claude/` should be kept out of `.gitignore` (i.e. committed into git)
- But sensitive auth tokens, private keys, etc. must never be written to `.claude/peers/`
- If `.claude/confer.toml` contains a token, that file is separately `.gitignore`d
- If conversation history contains secrets, they are automatically redacted and annotated

## Acceptance criteria

- [ ] Claude Code correctly loads all `.claude/peers/*/facts.md` as context on startup
- [ ] facts.md is updated within 1 second after `ask_peer`
- [ ] The file format is human-readable and machine-parseable (usable by both front-end and back-end tooling)
- [ ] markdown produces a clear git diff (not the kind JSON gives)
- [ ] Can hold at least 1000 facts without affecting performance
