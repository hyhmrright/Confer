# Confer — 项目记忆（.claude/peers/）

定义 Claude Code 集成下，知识沉淀到项目里的文件格式。这是 Confer 的核心创新之一：**让供应商知识跟着项目走，跨 session、跨开发者、跨设备都不丢**。

## 目录结构

每个项目根下：

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

跟着 git 走，所有协作者共享。

## 文件格式

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

结构化的事实清单。**每个事实都必须带引用**——没有引用的"事实"是 hallucination。

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

格式约定：

- 用 markdown 二级标题（`##`）分主题
- 每个 fact 用 list item
- 关键值用 `**bold**` 突出
- 每个 fact group 末尾必须有 `Source:` 行 + `Verified:` 时间戳
- 多个来源支持多行 `Source:`

### `decisions.md`

项目里做过的、和这个 peer 相关的设计决策。区别于 facts（厂商权威结论），decisions 是我们的选择。

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

格式约定：

- 每个决策有唯一 ID（`D1`, `D2`, ...）
- 必填字段：Date, Made by, Status
- Status: `Active` | `Superseded by D{n}` | `Deprecated`
- 必须列出 alternatives considered
- 必须 link 回相关 facts 和 code

### `conversations/{date}-{slug}.md`

完整对话历史。Confer 自动归档每条 thread 到这里。

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

### 文件命名约定

- conversations: `{ISO date}-{kebab-slug}.md`
- snippets: 按用途命名，扩展名匹配语言

## 写入和读取流程

### 写入路径

```
ask_peer 调用 →
  Confer cloud 返回答案 →
  MCP server 抽取结构化事实 →
  追加到本地 facts.md（如果是新 fact）
  追加完整对话到 conversations/
  更新 meta.json
  本地 commit hint：建议用户 git add .claude/peers/{slug}/
```

### 读取路径

```
Claude Code session 启动 →
  扫描 .claude/peers/*/ →
  把每个 peer 的 facts.md 作为系统提示词的一部分喂给 Claude Code →
  Claude Code 在写代码时自然引用这些事实
```

### 冲突处理

如果同一个 fact 被验证多次：

- 最新验证时间覆盖
- 如果新结果与旧结果矛盾，**不直接覆盖**，加 `⚠️ Conflict:` 标注，等用户手动决定

例如：

```markdown
- Default slave ID: ~~0x01 (1)~~ **0x0A (10)**
  - Source: X100 通信手册 v3.2 p.12 (says 1)
  - Source: X100 安装指南 p.12 (says 10) ← latest verification
  - ⚠️ Conflict: Vendor's two docs disagree. Use 10 per latest verification.
  - Verified: 2024-11-15
```

## 同步到服务端

可选地把项目记忆同步到 Confer 服务端（用户开关，默认本地优先）：

```bash
confer sync push    # 把本地 .claude/peers/ 上传
confer sync pull    # 从服务端拉最新版本（团队协作场景）
```

服务端用 `project_memory` 表存储（见 `docs/04-data-model.md`）。

为什么默认本地优先：
- 项目记忆是敏感信息（包含项目内部决策）
- 本地存储足够，git 已经处理了多人同步
- 服务端只是备份和"跨设备阅读"的便利

## 引用如何呈现

Claude Code 在生成代码时，对来自 facts.md 的事实自动加引用注释：

```python
# X100 register map: 0x40-0x47 temperature, 4 channels, int16 signed
# Source: X100 通信手册 v3.2 p.87 (verified 2024-11-15 via ABC Agent)
TEMP_REG_START = 0x40
TEMP_REG_COUNT = 8

# Default slave ID is 10 (not 1 as initial docs say)
# Source: .claude/peers/abc-industries/facts.md → D2 decision
DEFAULT_SLAVE_ID = 10
```

这样代码本身就带"为什么这么写"的证据链。

## 隐私和安全

- `.claude/` 默认应该被加到 `.gitignore` 之外（即 commit 进 git）
- 但敏感的认证 token、私钥等绝不写到 `.claude/peers/`
- `.claude/confer.toml` 里如果有 token，那个文件单独 `.gitignore`
- 对话历史中如果包含 secrets，自动 redact 并标注

## 验收标准

- [ ] Claude Code 启动时正确加载所有 `.claude/peers/*/facts.md` 作为上下文
- [ ] `ask_peer` 后 1 秒内 facts.md 更新到位
- [ ] 文件格式人类可读、机器可解析（前后端工具都能用）
- [ ] git diff 时 markdown 的 diff 清晰（不要 JSON 那种）
- [ ] 至少能容纳 1000 条 facts 不影响性能
