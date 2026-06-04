# Confer — Claude Code MCP plugin design

Turn Confer into an MCP server for Claude Code, so that while Claude Code writes code it can directly consult vendor / internal Agents and persist the answers into the project. **This is Confer's killer feature.**

## Design principles

It's not "bolting on a tool" — it's giving Claude Code a **team of domain experts**. Each vendor corresponds to a long-memory "specialist", whose knowledge persists into the project and is never lost across sessions.

Five design pillars (see the strategic insights in `docs/01-product.md` for details):

1. Vendor specialist subagent — a persistent domain expert
2. Project-level knowledge persistence — `.claude/peers/`
3. Pre-flight design review — run designs past the expert before writing code
4. Post-flight code review — have the expert review the code after it's written
5. Authority priority + identity transparency — within their own domain, the vendor's judgment overrides the generic LLM

## Installation

> The `claude mcp add … @confer/mcp-server` + OAuth below is the **target vision**. For what actually ships in v0.1, see "Current implementation (v0.1)" at the end of this section — what's landed is the env-var-authenticated `confer-a2a` plugin.

```bash
# 用户视角（愿景）
claude mcp add confer npx -y @confer/mcp-server

# 首次启动时引导 OAuth 绑定 Confer 账号
claude mcp config confer
# 选择实例：cloud.confer.ai / 自建实例 URL
# OAuth 跳转浏览器认证
```

Configuration file (edited by the user):

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

### Current implementation (v0.1)

The OAuth + npx package in the vision has not yet landed. What's implemented is **one-click installation via the plugin marketplace**, with authentication via environment variables (the signing private key always stays in the gateway and is never delegated out):

```bash
# 1. 加 marketplace 并安装 plugin（本仓库即 marketplace）
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer

# 2. 在 shell 导出账号（plugin 从环境读取，凭据不写入仓库）
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
# 可选：export CONFER_GATEWAY_URL=http://localhost:3000  (默认值)
```

The plugin bundles a self-contained bundle (`plugins/confer-a2a/dist/server.mjs`, which runs under bare `node` with no need for the monorepo or `bun`), generated from `packages/mcp-a2a` via `bun run --filter @confer/mcp-a2a build:plugin`. It provides 9 tools (`list_agents` / `ask_agent` / `follow_up` / `ask_multiple` / `check_reply`, etc.); for details see `plugins/confer-a2a/README.md` and `packages/mcp-a2a/README.md`.

Developers working inside the repo can also skip installing the plugin and use the root-level `.mcp.json` (which points at the source `server.ts`) or `claude mcp add` directly.

## Exposed MCP tools

### `ask_peer`

Ask a peer Agent a question.

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

Returns:

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

List the peer Agents currently available.

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

Discover a new peer Agent (domain lookup).

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

Read the knowledge accumulated in this project.

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

Write to project knowledge (usually called automatically after ask_peer, but can also be invoked manually).

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

Pre-flight: run the design plan past the expert.

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

Post-flight: have the expert review the written code.

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

## Exposed MCP resources

Claude Code can reference them with the `@resource:...` syntax.

### `confer://peers/{peer_slug}/facts`

Returns the facts file in markdown format.

### `confer://peers/{peer_slug}/conversations/{thread_id}`

Returns the full record of a given conversation.

### `confer://threads/{thread_id}`

Returns a conversation from the main app's IM as context (the user can copy the thread URL from the IM and hand it to Claude Code).

## Exposed MCP prompts

Prebuilt prompt templates that the user can trigger quickly.

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

## Autonomous decision behavior

After Claude Code calls the Confer MCP server, the server side provides hints to make Claude Code behave more intelligently:

### Signals that auto-trigger ask_peer

```toml
[auto_consult.triggers]
keywords_match_authority = true        # 代码/对话中出现 peer.authority 关键词
explicit_uncertainty     = true        # Claude Code 说 "I'm not sure" 时
import_vendor_lib        = true        # 导入了某个供应商的 SDK
```

How it works: the MCP server adds hints to the tool descriptions — for example, appending to the end of `ask_peer`'s description:

> "Strongly prefer calling this over guessing for any question about: X100, X200, Modbus, RTU, TCP, PowerSupply-lib (from registered peers' authority lists)."

Claude Code sees this hint and decides on its own to call it.

### Automatically writing project memory

After each successful `ask_peer`, the MCP server automatically attempts to structurally extract the "facts" from the answer and write them to `facts.md`:

```
[after ask_peer succeeds]
→ MCP server analyzes the answer
→ if it contains structured facts (numbers, addresses, codes), extract
→ append to .claude/peers/{peer_slug}/facts.md with citation
→ return enriched response to Claude Code
```

## Identity passthrough

A2A requests carry a `via: claude-code` tag:

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

The peer Agent can adjust its answer style based on `context.via`:

- `via: claude-code` → give structured answers (code blocks, JSON, clear field names)
- `via: web` → give natural-language answers with more explanation and context
- `via: mobile` → concise, with the key points emphasized for easy reading on a small screen

This hint is not mandatory — the peer Agent may ignore it. But everyone is encouraged to honor it.

## Security and trust

### Permission layer

By default, Claude Code calling `ask_peer` via MCP is L1 (read-only consultation). When it involves:

- `request_code_review` (sharing code with a peer) → L2, prompt the user the first time
- `share_files` (sharing a file directory) → L2
- `commit_on_behalf` (deciding on the user's behalf) → L3, prompt every time

Permission requests are forwarded by the MCP server to the main app, which pops up a permission card in the IM interface. The user decides, and the result goes back to Claude Code to continue working.

### Trust layer

- When `peer.{slug}.trust = "high"`, that peer's answers within its authority range override Claude Code's general knowledge
- When `trust = "medium"`, citations are used as reference but Claude Code annotates them
- When `trust = "low"` or newly added and unverified → always ask the user to confirm the cited result

### Rate and cost

Local rate limiting in the MCP server:

- At most 50 ask_peer calls per peer within a single Claude Code session
- When the cumulative cap is exceeded, pop up a "continue?" prompt
- Display the estimated cost of each call (based on the model the peer Agent uses)

## CLI commands

Supplementary tool commands the user runs in the shell:

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

## MCP server implementation notes

Tech stack:

- Bun + TypeScript
- `@modelcontextprotocol/sdk`
- Local SQLite cache (to avoid hitting the server every time)
- Keychain / Credential Manager to store the token

Main files:

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

Main entry point example:

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

## Acceptance criteria (v1)

- [ ] `claude mcp add confer` installs in a single line
- [ ] First-launch OAuth configuration walks the user through completely
- [ ] `ask_peer` end-to-end < 10s (including LLM thinking time)
- [ ] `read_project_memory` < 100ms (local cache hit)
- [ ] Pre-flight review lets Claude Code correct its plan
- [ ] Project memory travels with the repo after a git commit
- [ ] At least 1 public vendor Agent available (for the demo: mock-vendor.confer.dev)

## Implementation status (v0.1)

The above is the full vision. The first landed version, `packages/mcp-a2a`, has implemented the core loop of "consulting a peer agent":

**Architecture (two layers)**

- The gateway gains a user-initiated A2A outbound consultation capability (`/api/v1/consult/*`, see `docs/05-api.md`). Previously the platform only had the single A2A message-sending path of "inbound → auto-reply", with no path for the user to initiate outbound consultation.
- `packages/mcp-a2a`: a stdio MCP server that logs into the gateway as **one configured Confer user** to obtain a token, and exposes the consultation capability as tools. Signing still happens in the gateway; the private key never leaves the gateway.

**Implemented tools (9)**

| Domain | Tool |
|----|------|
| Discovery | `list_agents` / `get_agent_capabilities` / `find_agents` |
| Consultation | `ask_agent` (synchronous wait) / `follow_up` / `get_conversation` |
| Advanced | `ask_multiple` (parallel, cap 5) / `check_reply` (async fetch) |
| Ops | `whoami` |

**Connection** (`.mcp.json`; you must run `bun run dev` to start the gateway first)

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

**Gaps from the vision (to come)**: OAuth binding, vendor specialist long-term memory / `.claude/peers/` persistence, pre/post-flight review, and authority priority remain backlog; the current identity is a single configured user, replies use long polling, and pending permissions are surfaced as `pending` for now.
