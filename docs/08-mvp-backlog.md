# Confer — MVP 路线图与待办

按 milestone 切片，每个 milestone 是一个可交付的可演示版本。

## v0.1 — Core proof of concept（4-6 周）

**目标**：单机能跑通"用户 ↔ 自己 Agent ↔ 对方 Agent"全链路。

**Scope（必须做）**：

- [ ] 后端：gateway + agent runtime + conversation + identity（4 个服务，单进程或独立都行）
- [ ] PostgreSQL schema（参考 04-data-model.md），用 migration 工具管理
- [ ] 用户注册 / 登录（仅密码登录够了，不做 OAuth/passkey）
- [ ] DID:web 文档生成和暴露（`/.well-known/did.json`）
- [ ] AgentFacts 文档生成和暴露
- [ ] A2A 协议入站和出站（HTTP signature 验证 + capability token 验证）
- [ ] Agent runtime：LLM 调用循环（先只支持 Claude 和 DeepSeek 两个 provider）
- [ ] 简单策略引擎：白名单 peer + 全允许 / 全拒绝
- [ ] 客户端：单一 Tauri 应用，桌面三端先（Linux / macOS / Windows，移动端后期）
- [ ] 客户端能：登录 / 加联系人（按 DID 添加）/ 1对1 对话 / 看到引用
- [ ] WebSocket 实时消息推送（单实例够了，不做 NATS fan-out）
- [ ] SSE 流式 LLM 输出
- [ ] Docker Compose 一键起本地开发环境

**Out of scope**：

- 群聊、多 device fan-out、移动端、多语言 UI、CDN、外部 OAuth、复杂策略
- Claude Code 插件先不在这个里

**Acceptance**：

两个开发者本地各起一个 Confer 实例，互相加好友，互相对话，能看到引用。

---

## v0.2 — Claude Code 插件 MVP（3-4 周）

**目标**：在 Claude Code 里可以咨询 peer Agent，答案沉淀到项目。

**Scope**：

- [ ] MCP server 实现，提供 `ask_peer`、`list_peers`、`read_project_memory`、`write_project_memory` 4 个工具
- [ ] OAuth-style 绑定 Confer 账号到 Claude Code 实例
- [ ] `.claude/confer.toml` 配置文件解析
- [ ] `.claude/peers/{slug}/` 目录的读写（facts.md, decisions.md, conversations/, meta.json）
- [ ] 自动事实抽取：ask_peer 后从答案里提取结构化事实写入 facts.md
- [ ] `confer` CLI 工具（add peer, list peers, ask, sync）
- [ ] 一个 demo peer Agent（mock-vendor.confer.dev）让开发者测试

**Acceptance**：

开发者装 `claude mcp add confer`，配置后，在 Claude Code 里能问 mock vendor 问题，答案带引用，写到 `.claude/peers/mock-vendor/facts.md`，commit 到 git，下次 session 自动加载。

---

## v0.3 — 群聊和企业实例（4-5 周）

**目标**：支持群聊（用户 + Agent 混编），并能一台机器上部署"企业实例"。

**Scope**：

- [ ] 群聊数据模型和 UI
- [ ] 群成员管理（添加 / 移除人和 Agent）
- [ ] 多 @ Agent 同时回答（折叠展示，"采纳"机制）
- [ ] 企业实例：用自定义域名、SSO 登录（OIDC 即可）
- [ ] 联系人发现：按域名查找（输入 acme.com 自动找该域名公开的 Agent）
- [ ] 多设备 fan-out（NATS 引入）
- [ ] 移动端（iOS、Android）

**Acceptance**：

5 人小团队 + 2 Agent 在一个群里跑项目讨论，体验流畅。一家公司能自建 Confer 实例，对外暴露公开 Agent，被其他实例搜到。

---

## v0.4 — 多语言和离线代答（3 周）

**目标**：让产品对国际化场景和半异步沟通有用。

**Scope**：

- [ ] UI i18n（中文、英文起步，预留日德法）
- [ ] Agent 之间跨语言对话（翻译在目标 Agent 内部完成，引用保留原文）
- [ ] AgentFacts 加 `primary_language` 字段
- [ ] 离线代答：standing policy 设置 UI + pending inbox + push notification
- [ ] Pre-flight design review 工具加进 MCP server
- [ ] Post-flight code review 工具加进 MCP server

**Acceptance**：

中国开发者用中文问德国厂商的 Agent（德文 docs），拿到中文答案 + 德文原文引用。设了 standing policy 后，离线时 Agent 能正确处理符合规则的请求，把不确定的挂起。

---

## v1.0 — 生产就绪（4-6 周）

**目标**：能放到生产环境用，提供商业支持。

**Scope**：

- [ ] 完整可观测性（OTel tracing、Prometheus metrics、Loki logs）
- [ ] 备份和恢复（PG 物理备份 + S3 增量）
- [ ] 安全审计（关键操作有 audit log）
- [ ] 限流细化（4 维度全做）
- [ ] LLM 用量面板（per-Agent 月度成本）
- [ ] BYO LLM key 完整 UX（加密存储、轮换、配额）
- [ ] 文档站（用户使用手册、自建部署手册、API 参考）
- [ ] 公共 Confer Cloud 实例上线（`cloud.confer.ai`）

**Acceptance**：

至少 100 注册用户、10 个独立 peer Agent 部署、单实例稳定运行 30 天以上。

---

## v1.5+ — 增长和生态（持续）

**Scope**：

- [ ] 公共 Agent 目录（接入 NANDA Index）
- [ ] 信任图和声誉系统
- [ ] 个人 C 端版本（更轻量的 UI）
- [ ] Reputation-based 反垃圾
- [ ] Webhooks（第三方系统集成）
- [ ] 多 Agent per user（一个用户多个专业 Agent）
- [ ] 浏览器扩展（在网页上调用 Agent）

---

## 任务粒度（给 Claude Code 用）

每个 milestone 拆成 50-200 个小任务。每个任务：

1. 有明确输入输出
2. 有可测试的 acceptance criteria
3. 不超过 1 个开发者-日的工作量

例如 v0.1 的部分任务样例：

### 后端骨架

- [ ] 创建 monorepo（pnpm workspaces 或 Bun workspaces）
- [ ] `packages/shared`：共享类型定义（用 zod 或 valibot）
- [ ] `packages/gateway`：Bun + Hono 应用骨架
- [ ] `packages/agent-runtime`：Agent 状态机骨架
- [ ] `packages/conversation`：消息存储 / 推送服务
- [ ] `packages/identity`：DID + AgentFacts + A2A 验证
- [ ] PostgreSQL migration 工具（drizzle-kit 或 prisma）
- [ ] 创建所有数据表的 migration 文件

### 数据库层

- [ ] User CRUD（注册、登录、查个人信息）
- [ ] Agent CRUD（创建自己的 Agent、修改配置）
- [ ] PeerAgent CRUD（增、查、删联系人）
- [ ] Conversation CRUD + Participant 管理
- [ ] Message CRUD + 分页
- [ ] Permission 表的写入和查询

### 身份和协议

- [ ] DID document 生成（按 user 创建 ed25519 keypair）
- [ ] `/.well-known/did.json` endpoint
- [ ] AgentFacts 生成和 endpoint
- [ ] HTTP signature 签名器（出站）
- [ ] HTTP signature 验证器（入站）
- [ ] Capability token 签发和验证
- [ ] DID document fetcher + cache

### LLM 抽象

- [ ] LLM provider interface（chat, stream, tools）
- [ ] Claude provider 实现
- [ ] DeepSeek provider 实现
- [ ] API key 加密存储（Vault / env）
- [ ] Per-Agent model config 应用

### Agent runtime

- [ ] Agent 状态机：load → process → save 循环
- [ ] LLM 调用循环 + tool calling
- [ ] 简单策略引擎（白名单 + allow/deny）
- [ ] A2A 出站调用（Agent 给别人发消息）
- [ ] A2A 入站处理（收到别人 Agent 消息）

### Gateway 和 API

- [ ] JWT 签发 / 验证 middleware
- [ ] 所有 `/api/v1/auth/*` endpoints
- [ ] 所有 `/api/v1/conversations/*` endpoints
- [ ] WebSocket handler（订阅、发消息）
- [ ] SSE handler（LLM 流式输出）
- [ ] A2A inbound endpoints + signature 验证 middleware
- [ ] 限流 middleware（先简单版：固定窗口）

### 客户端

- [ ] Tauri 2.0 项目初始化
- [ ] 登录 / 注册页面
- [ ] 主界面：左侧联系人列表 + 右侧对话
- [ ] 添加联系人弹窗（按 DID 或域名）
- [ ] 对话消息列表（流式渲染）
- [ ] 引用胶囊渲染
- [ ] 权限请求卡片渲染
- [ ] WebSocket 连接管理
- [ ] 本地 SQLite 缓存最近 100 条消息

### Demo 内容

- [ ] mock-vendor 的 Agent 部署（演示用）
- [ ] X100 mock 手册（几页 PDF 作为 RAG 数据）
- [ ] 演示 video / 文档：从加好友到拿到答案的端到端流程

---

## 风险和需要的早期决策

| 风险 | 缓解 |
|---|---|
| MCP SDK 还在演化，API 可能 breaking | 接 stable 版本，monitor changelog，做适配层 |
| A2A 协议（Google）和 NANDA 标准都还在演化 | 用最简子集起步，预留协议适配层 |
| Tauri 2.0 iOS / Android 还相对新，可能踩坑 | MVP 阶段只做桌面三端，移动端 v0.3 再做 |
| LLM 成本失控 | 默认配额 + 显式 BYO key + 用量面板早做 |
| 国内 LLM provider 集成（DeepSeek/Qwen）的 SDK 不稳定 | 用 OpenAI 兼容接口（这些 provider 都支持）作为统一接入点 |

## 给 Claude Code 的实施提示

1. **先做单元测试再做集成**：每个 service 自身要能跑测试，不依赖其他 service 起来
2. **数据库迁移走 migration 工具**，不要手 SQL
3. **types 共享通过 `@confer/shared` 包**，前后端共用
4. **每个 PR 都要带文档变更**（如果改了协议或 API）
5. **A2A 协议的实现优先用现成库**（如 `http-message-signatures` npm 包），不要自己造轮子
6. **DID:web 实现优先用 `did-resolver` + `did-jwt`** 这些 W3C 工具
7. **MCP server 优先用官方 SDK** (`@modelcontextprotocol/sdk`)
8. **commit message 用 conventional commits** (feat:, fix:, docs:, etc.)
