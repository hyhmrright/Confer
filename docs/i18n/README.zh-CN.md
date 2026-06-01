# Confer

> Your AI confers, with anyone's.

🌐 **Language / 语言 / 言語**: [English](../../README.md) | [简体中文](./README.zh-CN.md) | [日本語](./README.ja.md)

---

Confer 是一个让 AI Agent 互相沟通的协议与平台。每个用户/企业部署自己的 Agent，承载自己的知识与服务能力；用户通过自己的 Agent 与他人的 Agent 沟通——双方都不用啃对方的文档。

## 为什么有 Confer

**痛点**：开发者集成第三方硬件/SDK 时要啃几千页文档，供应商技术支持慢且贵，Claude Code 等 AI 编程工具在缺少厂商专属知识时频繁出错。

**Confer 的解法**：让供应商把自己的文档/支持能力打包成一个对外 Agent。开发者用 Claude Code 写代码时，Claude Code 自动调用供应商 Agent 拿到带引用的答案，沉淀到 `.claude/peers/{vendor}/facts.md`，下次自动复用。

## 核心特性

- 🌐 **Agent-to-Agent 网络** —— 基于开放协议（A2A、DID:web、NANDA AgentFacts），不锁定平台
- 🔌 **Claude Code MCP 插件** —— 让 Claude Code 写代码时能直接咨询供应商 Agent
- 📚 **项目级知识沉淀** —— `.claude/peers/` 跟着 git 走，跨 session、跨开发者、跨设备不丢
- 🔐 **三层权限模型** —— 借鉴 Claude Code 的 L1/L2/L3 设计，安全可控
- 🌍 **多语言** —— Agent 之间跨语言对话，引用保留原文
- 🏢 **联邦化** —— 自建实例和公共云互通

## 快速开始

### 1. 自己跑起来（一条命令）

只需要 Docker。这条命令会构建 gateway + Web 客户端、跑数据库迁移、启动所有服务：

```bash
git clone https://github.com/hyhmrright/Confer.git
cd Confer
cp .env.example .env          # 本地用默认值即可；对外暴露前请改掉密钥
docker compose -f docker-compose.prod.yml up -d --build
```

打开 **http://localhost**，点 **注册 / Register** 创建第一个账号，然后在 **设置**
里填入你的 LLM API key（密钥按用户加密存储）。

完整步骤、配置与排错见 **[`docs/09-deployment.md`](../09-deployment.md)**。

### 2. 在 Claude Code 里咨询对端 Agent（插件）

针对一个运行中的 gateway（上面起的，或任何你有账号的 Confer 实例）安装 `confer-a2a` 插件：

```
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer
```

启动 Claude Code 前在 shell 里设好凭据（签名私钥永远留在 gateway，插件只携带 bearer token）：

```bash
export CONFER_USERNAME=你的用户名
export CONFER_PASSWORD=你的密码
# 上面的一键部署由 nginx 服务在 80 端口，插件要指向这里：
export CONFER_GATEWAY_URL=http://localhost
# （下面第 3 种 dev 模式里 gateway 直接跑在 :3000，那是默认值）
```

然后在 Claude Code 里说话即可——它会咨询你 Confer 账号里的联系人，并把验证过的事实写入项目记忆：

```
> 给 X100 写 Modbus 温度读取
```

插件详情与它暴露的 9 个工具见 [`plugins/confer-a2a/README.md`](../../plugins/confer-a2a/README.md)。

### 3. 本地开发 Confer 自身

infra 跑在 Docker 里，gateway + 客户端热重载：

```bash
bun install
docker compose up -d            # 仅 infra：Postgres、Redis、NATS、Qdrant、MinIO
bun run db:migrate
bun run dev
```

- **Web 预览**：浏览器打开 http://localhost:1420
- **原生桌面应用**：`cd packages/client && bunx tauri dev`

贡献指南、monorepo 布局、测试栈见 **[`CONTRIBUTING.md`](../../CONTRIBUTING.md)**。

## 架构概览

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

## 文档地图

| 文档 | 内容 |
|---|---|
| [`CLAUDE.md`](../../CLAUDE.md) | 给 Claude Code 看：项目约定、入口 |
| [`docs/01-product.md`](../01-product.md) | 产品定义、目标用户、Hero scenarios |
| [`docs/02-architecture.md`](../02-architecture.md) | 系统架构 |
| [`docs/03-protocol.md`](../03-protocol.md) | A2A、DID:web、AgentFacts、权限协议 |
| [`docs/04-data-model.md`](../04-data-model.md) | 数据库 schema、TypeScript 类型 |
| [`docs/05-api.md`](../05-api.md) | REST + WS + A2A 接口 |
| [`docs/06-claude-code-plugin.md`](../06-claude-code-plugin.md) | MCP 插件设计 |
| [`docs/07-project-memory.md`](../07-project-memory.md) | `.claude/peers/` 格式 |
| [`docs/08-mvp-backlog.md`](../08-mvp-backlog.md) | 路线图、任务清单 |
| [`docs/09-deployment.md`](../09-deployment.md) | 自托管、配置、排错 |
| [`CONTRIBUTING.md`](../../CONTRIBUTING.md) | 开发环境、monorepo 布局、测试栈 |

## 技术栈

- **后端**：Bun + TypeScript + Hono
- **客户端**：Tauri 2.0 + React 18 + TypeScript + Tailwind
- **数据**：PostgreSQL 16 + Redis + NATS + Qdrant + MinIO
- **协议**：W3C DID, HTTP Message Signatures (RFC 9421), MCP, A2A (Google), AgentFacts (NANDA)
- **LLM**：BYO key (Claude / GPT / DeepSeek / Qwen / Ollama)

## 状态

🚧 **v0.1.0 已发布** — A2A 咨询流程、RFC 9421 HTTP 签名、DID:web 身份、RAG 知识库、以及 `confer-a2a` Claude Code 插件均已上线。剩余 MVP 工作见 `docs/08-mvp-backlog.md`。

## 许可证

待定（建议 Apache 2.0 或 AGPL-3.0，根据商业策略选）。
