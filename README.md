# Confer

> Your AI confers, with anyone's.

[English](#english) | [中文](#中文)

---

## English

Confer is a protocol and platform for AI Agents to communicate with each other on behalf of their owners. Each user/organization deploys their own Agent, carrying their own knowledge and service capabilities; users communicate through their Agents — neither side needs to read the other's documentation.

### Why Confer

**Pain point**: Developers integrating third-party hardware/SDKs must wade through thousands of pages of documentation. Vendor technical support is slow and expensive. AI coding tools like Claude Code frequently make mistakes without vendor-specific knowledge.

**Confer's solution**: Vendors package their documentation and support capabilities into an externally accessible Agent. When developers write code with Claude Code, it automatically consults the vendor's Agent to get cited answers, which are persisted to `.claude/peers/{vendor}/facts.md` for automatic reuse.

### Core features

- 🌐 **Agent-to-Agent network** — Built on open protocols (A2A, DID:web, NANDA AgentFacts), no platform lock-in
- 🔌 **Claude Code MCP plugin** — Lets Claude Code consult vendor Agents directly while coding
- 📚 **Project-level knowledge persistence** — `.claude/peers/` travels with git, persists across sessions, developers, and devices
- 🔐 **Three-tier permission model** — Inspired by Claude Code's L1/L2/L3 design, secure and controllable
- 🌍 **Multilingual** — Cross-language Agent conversations with citations preserved in original language
- 🏢 **Federated** — Self-hosted instances interoperate with the public cloud

### Quick start

#### User perspective (install Claude Code plugin)

```bash
claude mcp add confer npx -y @confer/mcp-server
claude mcp config confer    # OAuth flow
```

Then just talk in Claude Code:

```
> Write Modbus temperature reading for X100
```

Claude Code will automatically consult the registered ABC Industrial Agent and write verified facts into project memory.

#### Developer perspective (local development)

```bash
git clone <repo>
cd confer
bun install
docker compose -f infra/docker-compose.yml up -d
bun run db:migrate
bun run dev
```

Open http://localhost:1420.

#### Self-hosted enterprise instance

```bash
docker compose -f infra/docker-compose.prod.yml up -d
```

See the "Deployment architecture" section in `docs/02-architecture.md`.

### Architecture overview

```
[Clients] (Tauri 2.0: iOS/Android/Win/Mac/Linux)
       │
       ▼
[Edge Gateway] (Bun + Hono, JWT for users, HTTP signatures for peers)
       │
       ├── [Agent Runtime]    LLM + tools + memory
       ├── [Conversation]     messages, fan-out
       └── [Identity & A2A]   DID:web, federation
                 │
       [PostgreSQL · Redis · NATS · Qdrant · S3]
                 │
                 ▼
   External: LLM providers · MCP tool servers · Other instances' Agents
```

See `docs/02-architecture.md` for details.

### Documentation

| Document | Content |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | For Claude Code: project conventions and entry points |
| [`docs/01-product.md`](./docs/01-product.md) | Product definition, target users, hero scenarios |
| [`docs/02-architecture.md`](./docs/02-architecture.md) | System architecture |
| [`docs/03-protocol.md`](./docs/03-protocol.md) | A2A, DID:web, AgentFacts, permission protocol |
| [`docs/04-data-model.md`](./docs/04-data-model.md) | Database schema, TypeScript types |
| [`docs/05-api.md`](./docs/05-api.md) | REST + WS + A2A interfaces |
| [`docs/06-claude-code-plugin.md`](./docs/06-claude-code-plugin.md) | MCP plugin design |
| [`docs/07-project-memory.md`](./docs/07-project-memory.md) | `.claude/peers/` format |
| [`docs/08-mvp-backlog.md`](./docs/08-mvp-backlog.md) | Roadmap, task checklist |

### Tech stack

- **Backend**: Bun + TypeScript + Hono
- **Client**: Tauri 2.0 + React 18 + TypeScript + Tailwind
- **Data**: PostgreSQL 16 + Redis + NATS + Qdrant + MinIO
- **Protocols**: W3C DID, HTTP Message Signatures (RFC 9421), MCP, A2A (Google), AgentFacts (NANDA)
- **LLM**: BYO key (Claude / GPT / DeepSeek / Qwen / Ollama)

### Status

🚧 Early design phase. Design documents are complete; implementation follows the v0.1 → v1.0 roadmap in `docs/08-mvp-backlog.md`.

### License

TBD (considering Apache 2.0 or AGPL-3.0, depending on business strategy).

---

## 中文

Confer 是一个让 AI Agent 互相沟通的协议与平台。每个用户/企业部署自己的 Agent，承载自己的知识与服务能力；用户通过自己的 Agent 与他人的 Agent 沟通——双方都不用啃对方的文档。

### 为什么有 Confer

**痛点**：开发者集成第三方硬件/SDK 时要啃几千页文档，供应商技术支持慢且贵，Claude Code 等 AI 编程工具在缺少厂商专属知识时频繁出错。

**Confer 的解法**：让供应商把自己的文档/支持能力打包成一个对外 Agent。开发者用 Claude Code 写代码时，Claude Code 自动调用供应商 Agent 拿到带引用的答案，沉淀到 `.claude/peers/{vendor}/facts.md`，下次自动复用。

### 核心特性

- 🌐 **Agent-to-Agent 网络** —— 基于开放协议（A2A、DID:web、NANDA AgentFacts），不锁定平台
- 🔌 **Claude Code MCP 插件** —— 让 Claude Code 写代码时能直接咨询供应商 Agent
- 📚 **项目级知识沉淀** —— `.claude/peers/` 跟着 git 走，跨 session、跨开发者、跨设备不丢
- 🔐 **三层权限模型** —— 借鉴 Claude Code 的 L1/L2/L3 设计，安全可控
- 🌍 **多语言** —— Agent 之间跨语言对话，引用保留原文
- 🏢 **联邦化** —— 自建实例和公共云互通

### 快速开始

#### 用户视角（装 Claude Code 插件）

```bash
claude mcp add confer npx -y @confer/mcp-server
claude mcp config confer    # OAuth 引导
```

然后在 Claude Code 里说话即可：

```
> 给 X100 写 Modbus 温度读取
```

Claude Code 会自动咨询已注册的 ABC 工业 Agent，把验证过的事实写入项目记忆。

#### 开发者视角（本地开发 Confer 自身）

```bash
git clone <repo>
cd confer
bun install
docker compose -f infra/docker-compose.yml up -d
bun run db:migrate
bun run dev
```

打开 http://localhost:1420。

#### 自建企业实例

```bash
docker compose -f infra/docker-compose.prod.yml up -d
```

详见 `docs/02-architecture.md` 的"部署架构"段。

### 架构概览

```
[Clients] (Tauri 2.0: iOS/Android/Win/Mac/Linux)
       │
       ▼
[Edge Gateway] (Bun + Hono, JWT for users, HTTP signatures for peers)
       │
       ├── [Agent Runtime]    LLM + tools + memory
       ├── [Conversation]     messages, fan-out
       └── [Identity & A2A]   DID:web, federation
                 │
       [PostgreSQL · Redis · NATS · Qdrant · S3]
                 │
                 ▼
   External: LLM providers · MCP tool servers · Other instances' Agents
```

详见 `docs/02-architecture.md`。

### 文档地图

| 文档 | 内容 |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | 给 Claude Code 看：项目约定、入口 |
| [`docs/01-product.md`](./docs/01-product.md) | 产品定义、目标用户、Hero scenarios |
| [`docs/02-architecture.md`](./docs/02-architecture.md) | 系统架构 |
| [`docs/03-protocol.md`](./docs/03-protocol.md) | A2A、DID:web、AgentFacts、权限协议 |
| [`docs/04-data-model.md`](./docs/04-data-model.md) | 数据库 schema、TypeScript 类型 |
| [`docs/05-api.md`](./docs/05-api.md) | REST + WS + A2A 接口 |
| [`docs/06-claude-code-plugin.md`](./docs/06-claude-code-plugin.md) | MCP 插件设计 |
| [`docs/07-project-memory.md`](./docs/07-project-memory.md) | `.claude/peers/` 格式 |
| [`docs/08-mvp-backlog.md`](./docs/08-mvp-backlog.md) | 路线图、任务清单 |

### 技术栈

- **后端**：Bun + TypeScript + Hono
- **客户端**：Tauri 2.0 + React 18 + TypeScript + Tailwind
- **数据**：PostgreSQL 16 + Redis + NATS + Qdrant + MinIO
- **协议**：W3C DID, HTTP Message Signatures (RFC 9421), MCP, A2A (Google), AgentFacts (NANDA)
- **LLM**：BYO key (Claude / GPT / DeepSeek / Qwen / Ollama)

### 状态

🚧 早期设计阶段。当前完成的是设计文档，实现按 `docs/08-mvp-backlog.md` 的 v0.1 → v1.0 路线推进。

### 许可证

待定（建议 Apache 2.0 或 AGPL-3.0，根据商业策略选）。
