# Confer — Claude Code MCP プラグイン設計

Confer を Claude Code の MCP server に仕立て、Claude Code がコードを書く際にベンダー/社内 Agent へ直接相談し、その回答をプロジェクトへ蓄積できるようにする。**これが Confer のキラー機能である**。

## 設計原則

これは「ツールを一つぶら下げる」のではなく、Claude Code に**ドメイン専門家チーム**を持たせることだ。各ベンダーは長期記憶を持つ「専門家」に対応し、知識はプロジェクトへ蓄積され、session をまたいでも失われない。

5 つの設計の柱（詳細は `docs/01-product.md` の戦略的洞察を参照）：

1. Vendor specialist subagent —— 永続化されたドメイン専門家
2. プロジェクトレベルの知識蓄積 —— `.claude/peers/`
3. Pre-flight design review —— コードを書く前にまず専門家を通す
4. Post-flight code review —— コードを書き終えたら再び専門家にレビューさせる
5. 権威優先度 + 身元の透明性 —— ベンダーは自らの領域内での判断において汎用 LLM を上回る

## インストール

> 以下の `claude mcp add … @confer/mcp-server` + OAuth は**目標とするビジョン**である。v0.1 の実際のインストールは本節末尾の「現在の実装 (v0.1)」を参照——すでに実現しているのは env-var 認証の `confer-a2a` plugin である。

```bash
# 用户视角（愿景）
claude mcp add confer npx -y @confer/mcp-server

# 首次启动时引导 OAuth 绑定 Confer 账号
claude mcp config confer
# 选择实例：cloud.confer.ai / 自建实例 URL
# OAuth 跳转浏览器认证
```

設定ファイル（ユーザーが編集）：

```toml
# .claude/confer.toml

[instance]
url    = "https://cloud.confer.ai"
token  = "encrypted-by-keychain"

[defaults]
auto_consult = true               # 检测到关键词自动咨询
review_mode  = "post-flight"      # never | pre-flight | post-flight | both
language     = "zh"

[peer.abc-industries]
did       = "did:web:acme.com:agents:support"
authority = ["X100", "X200", "Modbus", "RTU", "TCP"]
trust     = "high"

[peer.internal-sdk]
did       = "did:web:mycompany.com:agents:sdk-team"
authority = ["powersupply-lib", "internal-bus", "auth-service"]
trust     = "high"
```

### 現在の実装 (v0.1)

ビジョンにある OAuth + npx パッケージはまだ実現していない。すでに実現しているのは **plugin marketplace のワンクリックインストール**で、認証には環境変数を用いる（署名用の秘密鍵は常に gateway に留め、配布しない）：

```bash
# 1. 加 marketplace 并安装 plugin（本仓库即 marketplace）
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer

# 2. 在 shell 导出账号（plugin 从环境读取，凭据不写入仓库）
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
# 可选：export CONFER_GATEWAY_URL=http://localhost:3000  (默认值)
```

plugin は自己完結型の bundle（`plugins/confer-a2a/dist/server.mjs`、素の `node` だけで動作し、monorepo も `bun` も不要）を同梱しており、`packages/mcp-a2a` から `bun run --filter @confer/mcp-a2a build:plugin` で生成される。9 個のツール（`list_agents` / `ask_agent` / `follow_up` / `ask_multiple` / `check_reply` など）を提供し、詳細は `plugins/confer-a2a/README.md` と `packages/mcp-a2a/README.md` を参照。

リポジトリ内の開発者は plugin をインストールせず、ルートディレクトリの `.mcp.json`（ソースコードの `server.ts` を指す）または `claude mcp add` を直接使うこともできる。

## 公開する MCP ツール

### `ask_peer`

ある peer Agent に質問する。

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

戻り値:

```json
{
  "answer": "用 0x03 Read Holding Registers...",
  "citations": [{"source": "X100 通信手册 v3.2", "page": 87}],
  "thread_id": "thread_8f3a9c",
  "peer_did": "did:web:acme.com:agents:support",
  "latency_ms": 4231
}
```

### `list_peers`

現在利用可能な peer Agents を一覧表示する。

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

新しい peer Agent を発見する（ドメイン検索）。

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

本プロジェクトに蓄積された知識を読み取る。

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

プロジェクト知識を書き込む（通常は ask_peer の後に自動で呼び出されるが、手動でも可能）。

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

Pre-flight：設計案を専門家に一度通す。

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

Post-flight：書き上げたコードを専門家に review させる。

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

## 公開する MCP resources

Claude Code は `@resource:...` 構文で参照できる。

### `confer://peers/{peer_slug}/facts`

markdown 形式の facts ファイルを返す。

### `confer://peers/{peer_slug}/conversations/{thread_id}`

ある対話の完全な記録を返す。

### `confer://threads/{thread_id}`

メインプログラムの IM 内のある対話をコンテキストとして返す（ユーザーは IM 内で thread URL をコピーして Claude Code に渡せる）。

## 公開する MCP prompts

事前に用意した prompt template で、ユーザーが素早く起動できる。

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

## 自律的な意思決定の挙動

Claude Code が Confer MCP server を呼び出すと、server 側に Claude Code をより賢く振る舞わせる hint がある：

### ask_peer を自動的に発火させるシグナル

```toml
[auto_consult.triggers]
keywords_match_authority = true        # 代码/对话中出现 peer.authority 关键词
explicit_uncertainty     = true        # Claude Code 说 "I'm not sure" 时
import_vendor_lib        = true        # 导入了某个供应商的 SDK
```

実装方法：MCP server はツールの description に hint を加える。例えば `ask_peer` の description の末尾に次を加える：

> "Strongly prefer calling this over guessing for any question about: X100, X200, Modbus, RTU, TCP, PowerSupply-lib (from registered peers' authority lists)."

Claude Code はこの hint を見て自ら呼び出すかどうかを判断する。

### project memory への自動書き込み

`ask_peer` が成功するたびに、MCP server は回答中の「事実」を構造化抽出することを自動的に試み、`facts.md` へ書き込む：

```
[after ask_peer succeeds]
→ MCP server analyzes the answer
→ if it contains structured facts (numbers, addresses, codes), extract
→ append to .claude/peers/{peer_slug}/facts.md with citation
→ return enriched response to Claude Code
```

## 身元の貫通

A2A リクエストには `via: claude-code` タグを付与する：

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

相手の Agent は `context.via` に応じて回答スタイルを調整できる：

- `via: claude-code` → 構造化された回答を返す（コードブロック、JSON、明確なフィールド名）
- `via: web` → 自然言語の回答を返し、より多くの説明とコンテキストを添える
- `via: mobile` → 簡潔に、要点を際立たせ、小さい画面で読みやすくする

この hint は強制ではなく、相手の Agent は無視してよい。ただし皆が遵守することを推奨する。

## セキュリティと信頼

### 権限レイヤー

Claude Code が MCP 経由で `ask_peer` を呼ぶ場合、デフォルトは L1（読み取り専用の相談）である。次に関わるものは：

- `request_code_review`（peer にコードを共有）→ L2、初回はユーザーに確認
- `share_files`（ファイルディレクトリを共有）→ L2
- `commit_on_behalf`（ユーザーに代わって決定）→ L3、毎回確認

権限リクエストは MCP server からメインプログラムへ転送され、メインプログラムは IM 画面に権限カードをポップアップし、ユーザーが決定し、その結果が Claude Code に戻って作業を継続する。

### 信頼レイヤー

- `peer.{slug}.trust = "high"` のとき、その peer の authority 範囲内の回答は Claude Code の汎用知識を上回る
- `trust = "medium"` のとき、引用は参考として扱われるが Claude Code は注記を付ける
- `trust = "low"` または新規追加で未検証のもの → 常にユーザーに引用結果の確認を求める

### レートとコスト

MCP server のローカルでのレート制限：

- 単一の Claude Code session 内で単一の peer に対し ask_peer は最大 50 回まで
- 累計上限を超えると「続行するか」の確認をポップアップする
- 各呼び出しの推定コストを表示する（相手の Agent が使うモデルに基づく）

## CLI コマンド

補助的なツールコマンドで、ユーザーは shell 内で使う：

```bash
# 列出已注册 peer
confer peer list

# 添加 peer
confer peer add abc-industries --did did:web:acme.com:agents:support
confer peer add abc-industries --domain acme.com    # 自动查 well-known

# 查看项目记忆
confer memory show abc-industries
confer memory show abc-industries --section facts

# 直接命令行问
confer ask abc-industries "X100 在 RTU 模式下电压范围？"

# 同步项目记忆到 Confer 服务端
confer sync push
confer sync pull
```

## MCP server 実装のポイント

技術スタック：

- Bun + TypeScript
- `@modelcontextprotocol/sdk`
- ローカル SQLite キャッシュ（毎回サーバーへアクセスするのを避ける）
- Keychain / Credential Manager で token を保存

主なファイル：

```
packages/mcp-server/
├── src/
│   ├── index.ts              # MCP server 主入口
│   ├── tools/
│   │   ├── ask-peer.ts
│   │   ├── list-peers.ts
│   │   ├── discover-peer.ts
│   │   ├── project-memory.ts
│   │   ├── design-review.ts
│   │   └── code-review.ts
│   ├── resources/
│   ├── prompts/
│   ├── client.ts             # Confer API client
│   ├── auth.ts               # OAuth flow
│   ├── cache.ts              # SQLite 本地缓存
│   └── config.ts             # 读 .claude/confer.toml
└── package.json
```

主エントリの例：

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

## 受け入れ基準（v1）

- [ ] `claude mcp add confer` 一行でインストール完了
- [ ] 初回起動時の OAuth 設定誘導が完結している
- [ ] `ask_peer` が全工程 < 10s（LLM の思考時間を含む）
- [ ] `read_project_memory` < 100ms（ローカルキャッシュヒット）
- [ ] Pre-flight review で Claude Code が方針を修正できる
- [ ] プロジェクト記憶が git コミット後にリポジトリと一緒に追従する
- [ ] 少なくとも 1 つの公開ベンダー Agent が利用可能（demo 用：mock-vendor.confer.dev）

## 実装ステータス（v0.1）

上記は完全なビジョンである。初めて実現したバージョン `packages/mcp-a2a` は、「peer agent への相談」というコアな閉ループをすでに実装している：

**アーキテクチャ（2 レイヤー）**

- Gateway にユーザー発のA2A アウトバウンド相談機能を新設（`/api/v1/consult/*`、`docs/05-api.md` 参照）。これ以前、プラットフォームには「インバウンド→自動返信」という A2A メッセージ送信経路が一つあるだけで、ユーザーが能動的にアウトバウンドする経路は一切なかった。
- `packages/mcp-a2a`：stdio MCP server で、**設定済みの 1 人の Confer ユーザー**として gateway にログインして token を取得し、相談機能をツールとして公開する。署名は依然 gateway にあり、秘密鍵は gateway から出ない。

**実装済みツール（9 個）**

| ドメイン | ツール |
|----|------|
| 発見 | `list_agents` / `get_agent_capabilities` / `find_agents` |
| 相談 | `ask_agent`（同期待機）/ `follow_up` / `get_conversation` |
| 応用 | `ask_multiple`（並列、上限 5）/ `check_reply`（非同期取得） |
| 運用 | `whoami` |

**接続**（`.mcp.json`、先に `bun run dev` で gateway を起動する必要がある）

```jsonc
{
  "mcpServers": {
    "confer-a2a": {
      "command": "bun",
      "args": ["run", "packages/mcp-a2a/src/server.ts"],
      "env": {
        "CONFER_GATEWAY_URL": "http://localhost:3000",
        "CONFER_USERNAME": "${CONFER_USERNAME}",
        "CONFER_PASSWORD": "${CONFER_PASSWORD}"
      }
    }
  }
}
```

**ビジョンとの差分（今後）**：OAuth バインド、vendor specialist の長期記憶 / `.claude/peers/` への蓄積、pre/post-flight review、権威優先度は依然 backlog である。現状の身元は単一の設定済みユーザー、返信はロングポーリングを使用、承認待ちの権限はさしあたり `pending` として表示する。
