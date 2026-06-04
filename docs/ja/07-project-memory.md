# Confer — プロジェクトメモリ（.claude/peers/）

Claude Code 連携下において、知識をプロジェクトへ蓄積するためのファイル形式を定義する。これは Confer の中核的なイノベーションの一つである。**ベンダーの知識をプロジェクトに帯同させ、session 間・開発者間・デバイス間のいずれをまたいでも失われないようにする**。

## ディレクトリ構造

各プロジェクトのルート直下：

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

git に帯同し、すべてのコラボレーターで共有される。

## ファイル形式

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

構造化された事実の一覧。**各事実には必ず引用を添えること**——引用のない「事実」は hallucination である。

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

書式の約束事：

- markdown の二次見出し（`##`）でトピックを分ける
- 各 fact は list item で記述する
- 重要な値は `**bold**` で強調する
- 各 fact group の末尾には必ず `Source:` 行 + `Verified:` タイムスタンプを置く
- 複数のソースは複数行の `Source:` で記述できる

### `decisions.md`

プロジェクト内で下した、この peer に関連する設計上の決定。facts（ベンダーの権威ある結論）とは異なり、decisions は我々自身の選択である。

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

書式の約束事：

- 各決定には一意の ID（`D1`, `D2`, ...）を付与する
- 必須フィールド：Date, Made by, Status
- Status: `Active` | `Superseded by D{n}` | `Deprecated`
- alternatives considered を必ず列挙する
- 関連する facts と code へ必ずリンクを張る

### `conversations/{date}-{slug}.md`

完全な対話履歴。Confer は各 thread を自動的にここへアーカイブする。

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

### ファイル命名の約束事

- conversations: `{ISO date}-{kebab-slug}.md`
- snippets: 用途に応じて命名し、拡張子は言語に一致させる

## 書き込みと読み込みのフロー

### 書き込みパス

```
ask_peer 调用 →
  Confer cloud 返回答案 →
  MCP server 抽取结构化事实 →
  追加到本地 facts.md（如果是新 fact）
  追加完整对话到 conversations/
  更新 meta.json
  本地 commit hint：建议用户 git add .claude/peers/{slug}/
```

### 読み込みパス

```
Claude Code session 启动 →
  扫描 .claude/peers/*/ →
  把每个 peer 的 facts.md 作为系统提示词的一部分喂给 Claude Code →
  Claude Code 在写代码时自然引用这些事实
```

### 競合の処理

同一の fact が複数回検証された場合：

- 最新の検証時刻で上書きする
- 新しい結果が古い結果と矛盾する場合は、**直接上書きせず**、`⚠️ Conflict:` の注記を付けて、ユーザーの手動判断を待つ

例えば：

```markdown
- Default slave ID: ~~0x01 (1)~~ **0x0A (10)**
  - Source: X100 通信手册 v3.2 p.12 (says 1)
  - Source: X100 安装指南 p.12 (says 10) ← latest verification
  - ⚠️ Conflict: Vendor's two docs disagree. Use 10 per latest verification.
  - Verified: 2024-11-15
```

## サーバー側への同期

オプションとして、プロジェクトメモリを Confer のサーバー側へ同期できる（ユーザーが切り替え可能。デフォルトはローカル優先）：

```bash
confer sync push    # 把本地 .claude/peers/ 上传
confer sync pull    # 从服务端拉最新版本（团队协作场景）
```

サーバー側は `project_memory` テーブルで保存する（`docs/04-data-model.md` を参照）。

デフォルトをローカル優先とする理由：
- プロジェクトメモリは機微な情報である（プロジェクト内部の決定を含む）
- ローカル保存で十分であり、git がすでに複数人の同期を処理している
- サーバー側はバックアップと「デバイス横断での閲覧」の利便性にすぎない

## 引用の提示のされ方

Claude Code はコードを生成する際、facts.md 由来の事実に対して自動的に引用コメントを付与する：

```python
# X100 register map: 0x40-0x47 temperature, 4 channels, int16 signed
# Source: X100 通信手册 v3.2 p.87 (verified 2024-11-15 via ABC Agent)
TEMP_REG_START = 0x40
TEMP_REG_COUNT = 8

# Default slave ID is 10 (not 1 as initial docs say)
# Source: .claude/peers/abc-industries/facts.md → D2 decision
DEFAULT_SLAVE_ID = 10
```

こうすることで、コード自体が「なぜこう書いたのか」の証拠チェーンを帯びる。

## プライバシーとセキュリティ

- `.claude/` はデフォルトで `.gitignore` の対象外とすべきである（すなわち git に commit する）
- ただし機微な認証 token や秘密鍵などは絶対に `.claude/peers/` へ書き込まない
- `.claude/confer.toml` に token が含まれる場合は、そのファイルを単独で `.gitignore` する
- 対話履歴に secrets が含まれる場合は、自動的に redact して注記する

## 受け入れ基準

- [ ] Claude Code 起動時にすべての `.claude/peers/*/facts.md` がコンテキストとして正しくロードされる
- [ ] `ask_peer` の後 1 秒以内に facts.md が更新されて反映される
- [ ] ファイル形式が人間にも可読で、機械でも解析可能である（フロントエンド/バックエンド双方のツールで利用できる）
- [ ] git diff の際に markdown の diff が明瞭である（JSON のようなものにしない）
- [ ] 少なくとも 1000 件の facts を性能に影響なく収容できる
