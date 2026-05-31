# Confer — Claude Code MCP 插件设计

把 Confer 做成 Claude Code 的 MCP server，让 Claude Code 写代码时能直接咨询供应商/内部 Agent，把答案沉淀到项目里。**这是 Confer 的杀手特性**。

## 设计原则

不是"挂个工具"，是让 Claude Code 拥有**领域专家团队**。每个供应商对应一个长期记忆的"专家"，知识沉淀到项目，跨 session 不丢。

五个设计支柱（详见 `docs/01-product.md` 的战略洞察）：

1. Vendor specialist subagent —— 持久化的领域专家
2. 项目级知识沉淀 —— `.claude/peers/`
3. Pre-flight design review —— 写代码前先过专家
4. Post-flight code review —— 写完代码再让专家审
5. 权威优先级 + 身份透明 —— 厂商在自己领域内的判断压倒通用 LLM

## 安装

```bash
# 用户视角
claude mcp add confer npx -y @confer/mcp-server

# 首次启动时引导 OAuth 绑定 Confer 账号
claude mcp config confer
# 选择实例：cloud.confer.ai / 自建实例 URL
# OAuth 跳转浏览器认证
```

配置文件（用户编辑）：

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

## 暴露的 MCP 工具

### `ask_peer`

向某个 peer Agent 提问。

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

返回:

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

列出当前可用的 peer Agents。

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

发现新的 peer Agent（域名查找）。

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

读取本项目沉淀的知识。

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

写入项目知识（通常 ask_peer 后自动调用，也可手动）。

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

Pre-flight：把设计方案给专家过一遍。

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

Post-flight：让专家 review 写好的代码。

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

## 暴露的 MCP resources

Claude Code 可以用 `@resource:...` 语法引用。

### `confer://peers/{peer_slug}/facts`

返回 markdown 格式的 facts 文件。

### `confer://peers/{peer_slug}/conversations/{thread_id}`

返回某条对话的完整记录。

### `confer://threads/{thread_id}`

返回主程序 IM 里的某条对话作为上下文（用户可以在 IM 里复制 thread URL 给 Claude Code）。

## 暴露的 MCP prompts

预制 prompt template，用户可以快速触发。

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

## 自主决策行为

Claude Code 调用 Confer MCP server 后，server 端有 hint 让 Claude Code 表现得更智能：

### 自动触发 ask_peer 的信号

```toml
[auto_consult.triggers]
keywords_match_authority = true        # 代码/对话中出现 peer.authority 关键词
explicit_uncertainty     = true        # Claude Code 说 "I'm not sure" 时
import_vendor_lib        = true        # 导入了某个供应商的 SDK
```

实现方式：MCP server 在工具描述里加 hint，例如 `ask_peer` 的 description 末尾加：

> "Strongly prefer calling this over guessing for any question about: X100, X200, Modbus, RTU, TCP, PowerSupply-lib (from registered peers' authority lists)."

Claude Code 看到这个 hint 自己决定调用。

### 自动写 project memory

每次 `ask_peer` 成功后，MCP server 自动尝试结构化抽取答案中的"事实"，写到 `facts.md`：

```
[after ask_peer succeeds]
→ MCP server analyzes the answer
→ if it contains structured facts (numbers, addresses, codes), extract
→ append to .claude/peers/{peer_slug}/facts.md with citation
→ return enriched response to Claude Code
```

## 身份穿透

A2A 请求里带 `via: claude-code` 标签：

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

对方 Agent 可以根据 `context.via` 调整回答风格：

- `via: claude-code` → 给结构化答案（代码块、JSON、清晰的字段名）
- `via: web` → 给自然语言答案，带更多解释和上下文
- `via: mobile` → 简洁，重点突出，便于小屏阅读

这个 hint 不是强制，对方 Agent 可以忽略。但建议大家都遵守。

## 安全和信任

### 权限层

Claude Code 通过 MCP 调 `ask_peer` 默认是 L1（只读咨询）。涉及到：

- `request_code_review`（共享代码给 peer）→ L2，第一次询问用户
- `share_files`（共享文件目录）→ L2
- `commit_on_behalf`（替用户决策）→ L3，每次询问

权限请求通过 MCP server 转发到主程序，主程序在 IM 界面弹出权限卡片，用户决定，结果回到 Claude Code 继续工作。

### 信任层

- `peer.{slug}.trust = "high"` 时，该 peer 在 authority 范围内的回答压倒 Claude Code 通用知识
- `trust = "medium"` 时，引用作为参考但 Claude Code 会标注
- `trust = "low"` 或新加未验证的 → 总是要求用户确认引用结果

### 速率和成本

MCP server 本地限流：

- 单次 Claude Code session 内对单个 peer 最多 50 次 ask_peer
- 累计上限超过时弹"是否继续"提示
- 显示每次调用的预估成本（基于对方 Agent 用的模型）

## CLI 命令

补充工具命令，用户在 shell 里用：

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

## MCP server 实现要点

技术栈：

- Bun + TypeScript
- `@modelcontextprotocol/sdk`
- 本地 SQLite 缓存（避免每次都打服务器）
- Keychain / Credential Manager 存 token

主要文件：

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

主入口示例：

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

## 验收标准（v1）

- [ ] `claude mcp add confer` 一行装好
- [ ] 首次启动引导 OAuth 配置完整
- [ ] `ask_peer` 全程 < 10s（包括 LLM 思考时间）
- [ ] `read_project_memory` < 100ms（本地缓存命中）
- [ ] Pre-flight review 能让 Claude Code 修正方案
- [ ] 项目记忆在 git 提交后跟着仓库走
- [ ] 至少 1 个公开供应商 Agent 可用（demo 用：mock-vendor.confer.dev）

## 实现状态（v0.1）

上文是完整愿景。首个落地版本 `packages/mcp-a2a` 已实现"咨询 peer agent"这一核心闭环：

**架构（两层）**

- Gateway 新增用户发起的 A2A 出站咨询能力（`/api/v1/consult/*`，见 `docs/05-api.md`）。此前平台只有"入站→自动回复"一条 A2A 发消息路径，无任何用户主动出站路径。
- `packages/mcp-a2a`：stdio MCP server，以**一个配置的 Confer 用户**身份登录 gateway 取 token，把咨询能力暴露成工具。签名仍在 gateway，私钥不出 gateway。

**已实现工具（9 个）**

| 域 | 工具 |
|----|------|
| 发现 | `list_agents` / `get_agent_capabilities` / `find_agents` |
| 咨询 | `ask_agent`（同步等待）/ `follow_up` / `get_conversation` |
| 进阶 | `ask_multiple`（并行，上限 5）/ `check_reply`（异步取） |
| 运维 | `whoami` |

**连接**（`.mcp.json`，需先 `bun run dev` 起 gateway）

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

**与愿景的差距（后续）**：OAuth 绑定、vendor specialist 长期记忆 / `.claude/peers/` 沉淀、pre/post-flight review、权威优先级仍为 backlog；当前身份为单一配置用户、回复用长轮询、待批权限暂以 `pending` 呈现。
