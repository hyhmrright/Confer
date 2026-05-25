# Confer — 系统架构

## 高层架构

```
┌────────────────────────────────────────────────────────────┐
│  Clients (Tauri 2.0)                                       │
│  iOS · Android · Windows · macOS · Linux                   │
└──────────────────────────┬─────────────────────────────────┘
                           │ WSS / HTTPS / SSE
                           ▼
┌────────────────────────────────────────────────────────────┐
│  Edge API Gateway  (Bun + Hono)                            │
│  Auth · Rate limit · Routing · WS fan-out                  │
└─────┬─────────────┬─────────────────┬────────────────┬─────┘
      │             │                 │                │
      ▼             ▼                 ▼                ▼
 ┌────────┐  ┌─────────────┐  ┌────────────┐  ┌──────────────┐
 │ Agent  │  │Conversation │  │ Identity & │  │ MCP / Tools  │
 │Runtime │  │     Hub     │  │A2A Gateway │  │  Connector   │
 └───┬────┘  └──────┬──────┘  └─────┬──────┘  └──────┬───────┘
     │              │               │                │
     ▼              ▼               ▼                ▼
┌──────────────────────────────────────────────────────────────┐
│  Data layer: PostgreSQL · Redis · NATS · Vector (Qdrant)·S3 │
└──────────────────────────────────────────────────────────────┘
       │                              │
       ▼                              ▼
 LLM providers              Other instances' Agents
 (Claude / GPT /            (federation via A2A
  DeepSeek / Qwen)           over HTTPS)
```

## 设计原则

- **Stateless edge, stateful core**：网关无状态，可水平扩展；Agent runtime 按用户分片，状态在 PG/Redis
- **Federation-ready from day 1**：用 DID:web 身份 + AgentFacts，单实例也按联邦协议跑，未来联邦化零迁移成本
- **BYO LLM key**：平台不承担 LLM 成本，用户用自己的 API key
- **协议优先**：核心交互用开放协议（A2A、MCP、DID:web、NANDA AgentFacts），不绑死自家私有协议
- **Bun + TypeScript 全栈**：后端 Bun + Hono，客户端 Tauri + React，类型可共享

## 服务边界

### 1. Edge API Gateway

参考 `docs/05-api.md`。

- **职责**：TLS 终止、用户/A2A 双身份验证、四维限流、HTTP/WS/SSE 路由、多设备 fan-out
- **技术栈**：Bun + Hono
- **关键依赖**：JWKS（用户 token 验证）、DID document cache、NATS（fan-out）
- **不做**：业务逻辑、持久化业务数据、调 LLM

### 2. Agent Runtime

每个用户对应一个常驻 Agent 实例。

- **职责**：
  - 维护用户 Agent 的状态（model 选择、tools、policy、memory）
  - LLM 调用循环（多 provider 抽象）
  - MCP 客户端，连接用户安装的工具服务器
  - A2A 出站调用（去找别人的 Agent 谈事）
  - 策略引擎（决定能告诉对方什么）
- **生命周期**：按需唤醒。消息进来或 A2A 请求到达时，从 PG 加载状态，跑完一轮，写回。
- **关键依赖**：LLM providers、MCP servers、Identity service

### 3. Conversation Hub

- **职责**：消息存储、订阅、推送
- **支持的对话类型**：
  - 用户 ↔ 自己的 Agent
  - 用户 ↔ 对方 Agent（通过自己 Agent 中转）
  - 用户 ↔ 用户（普通 IM）
  - 群聊（用户 + Agent 混合）
- **关键依赖**：NATS Streams（持久化 + 扇出）、PG（历史消息）、Redis（presence、未读计数）

### 4. Identity & A2A Gateway

- **职责**：
  - 管理用户的 DID:web 文档
  - 暴露和缓存 AgentFacts
  - 处理入站 A2A 请求（验证 HTTP signature、capability token）
  - 转发出站 A2A 请求
  - 联邦 peer 限流和反垃圾
- **关键依赖**：PG（DID/peer 缓存）、Redis（counter 限流）

详细协议设计参考 `docs/03-protocol.md`。

### 5. MCP / Tools Connector

- **职责**：
  - 用户安装的 MCP 工具服务器的连接管理
  - Agent runtime 通过这里调用工具
  - 工具调用结果的标准化封装
- **关键依赖**：`@modelcontextprotocol/sdk`

## 数据层

| 组件 | 用途 |
|---|---|
| PostgreSQL | 用户、Agent、对话、消息、权限、peer 关系（主存储） |
| Redis | session、presence、限流计数、热数据缓存 |
| NATS Streams | 消息扇出（user.{uid}.events）+ Agent runtime 任务队列 |
| Qdrant 或 pgvector | Agent 长期记忆 RAG、用户资料库索引 |
| S3-compatible (MinIO) | 文件附件、DID document 备份、对话归档 |

## 客户端架构

- **基座**：Tauri 2.0（Rust 内核 + WebView 渲染）
- **前端**：React 18 + TypeScript + Tailwind CSS
- **状态管理**：Zustand 或 Jotai（轻量）
- **路由**：TanStack Router
- **网络**：原生 fetch + native WebSocket + EventSource (SSE)
- **本地存储**：Tauri 提供的 SQLite + key-value store（缓存对话、离线消息草稿）

### 跨平台覆盖

| 平台 | 通过 |
|---|---|
| iOS | Tauri 2.0 iOS support |
| Android | Tauri 2.0 Android support |
| Windows | Tauri 2.0 |
| macOS | Tauri 2.0 |
| Linux | Tauri 2.0 |

单一代码库，无原生 fallback。

### Claude Code 插件

参考 `docs/06-claude-code-plugin.md`。

- 独立的 MCP server 进程，用 Node.js / Bun 实现
- 用户通过 `claude mcp add confer <command>` 安装
- 通过 OAuth / token 与用户的 Confer 账号绑定

## 部署架构

### 单实例（个人/小团队）

```
docker-compose.yml:
  - gateway       (Bun 服务)
  - agent-runtime (Bun 服务)
  - conversation  (Bun 服务)
  - identity      (Bun 服务)
  - postgres
  - redis
  - nats
  - qdrant
  - minio
  - caddy / traefik  (反向代理 + TLS)
```

部署方式：`docker compose up -d` 起来就能用。

### 企业实例

- 同上 Docker Compose 起一个独立部署
- 用自己的域名（`acme.com`）
- 暴露 `https://acme.com/.well-known/did.json` 和 `https://acme.com/.well-known/agent.json`
- 内部用户走 SSO 登录

### 云端（Confer 自家云）

- Kubernetes 多租户
- 每个用户/企业有自己的 namespace 或 schema
- 共享 LLM provider 抽象层（但仍使用用户自己的 key）
- 全球多区域部署，最近区域接入

## 联邦化（跨实例）

任何一个 Confer 实例（自建或云端）都可以通过 A2A 协议和其他实例互通。

```
[acme.com]              [vendor-x.com]            [confer.cloud]
 Agent A    <─── A2A ───> Agent B    <─── A2A ───> Agent C
```

身份和发现：

- 每个实例在 `/.well-known/did.json` 暴露 DID document
- 每个 Agent 在 `/.well-known/agent.json` 暴露 AgentFacts
- 跨实例搜索：fan-out 到已知的实例 + 公共注册表

## 可观测性

- **Tracing**：OpenTelemetry，trace_id 从 gateway 注入贯穿所有服务
- **日志**：JSON 结构化，Vector / Loki 收集
- **指标**：Prometheus，关键指标：
  - `gateway_active_ws_connections{user_id}`
  - `agent_runtime_llm_tokens_total{provider,role}`
  - `a2a_inbound_requests_total{peer_domain,status}`
  - `mcp_tool_calls_total{tool,result}`

## 安全边界

- 用户 ↔ gateway：JWT + JWKS 验证
- A2A peer ↔ gateway：HTTP Message Signatures (RFC 9421) + DID:web 公钥
- 服务间内部 RPC：mTLS 或共享 secret（Docker network 内）
- LLM provider 调用：API key 加密存储（AES-256，key 在 Vault / KMS）
- 用户文件存储：S3 server-side encryption

## 关键技术决策

| 决策 | 选择 | 备选 | 理由 |
|---|---|---|---|
| 后端语言 | Bun + TypeScript | Go | MCP/A2A SDK 是 TS-first；全栈类型共享 |
| Web 框架 | Hono | Elysia, Fastify | 轻、快、生态稳 |
| 客户端 | Tauri 2.0 | Flutter, Electron | 单代码库 5 平台，Rust 安全，体积小 |
| 主存储 | PostgreSQL 16 | MySQL | JSON 支持好，扩展性强，pgvector 可选 |
| 消息总线 | NATS | Kafka, Redis Pub/Sub | 轻、持久化、精确订阅 |
| 向量库 | Qdrant | Pinecone, pgvector | 自托管成熟、Rust 写的性能稳 |
| 身份 | DID:web | DID:key, OAuth-only | 与 web 基建兼容，NANDA 推荐 |
| 协议 | A2A + MCP + AgentFacts | 自有协议 | 押注开放协议生态 |
