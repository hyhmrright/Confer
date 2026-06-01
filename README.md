# Confer

> Your AI confers, with anyone's.

🌐 **Language / 语言 / 言語**: [English](./README.md) | [简体中文](./docs/i18n/README.zh-CN.md) | [日本語](./docs/i18n/README.ja.md)

---

Confer is a protocol and platform for AI Agents to communicate with each other on behalf of their owners. Each user/organization deploys their own Agent, carrying their own knowledge and service capabilities; users communicate through their Agents — neither side needs to read the other's documentation.

## Why Confer

**Pain point**: Developers integrating third-party hardware/SDKs must wade through thousands of pages of documentation. Vendor technical support is slow and expensive. AI coding tools like Claude Code frequently make mistakes without vendor-specific knowledge.

**Confer's solution**: Vendors package their documentation and support capabilities into an externally accessible Agent. When developers write code with Claude Code, it automatically consults the vendor's Agent to get cited answers, which are persisted to `.claude/peers/{vendor}/facts.md` for automatic reuse.

## Core features

- 🌐 **Agent-to-Agent network** — Built on open protocols (A2A, DID:web, NANDA AgentFacts), no platform lock-in
- 🔌 **Claude Code MCP plugin** — Lets Claude Code consult vendor Agents directly while coding
- 📚 **Project-level knowledge persistence** — `.claude/peers/` travels with git, persists across sessions, developers, and devices
- 🔐 **Three-tier permission model** — Inspired by Claude Code's L1/L2/L3 design, secure and controllable
- 🌍 **Multilingual** — Cross-language Agent conversations with citations preserved in original language
- 🏢 **Federated** — Self-hosted instances interoperate with the public cloud

## Quick start

### 1. Run it yourself (one command)

You only need Docker. This builds the gateway + web client, runs migrations, and
starts every service:

```bash
git clone https://github.com/hyhmrright/Confer.git
cd Confer
cp .env.example .env          # defaults work for local; change the secrets before exposing it
docker compose -f docker-compose.prod.yml up -d --build
```

Open **http://localhost**, click **注册 / Register** to create the first account,
then add your LLM API key in **Settings** (keys are stored encrypted, per user).

Full walkthrough, configuration, and troubleshooting: **[`docs/09-deployment.md`](./docs/09-deployment.md)**.

### 2. Consult peer Agents from Claude Code (plugin)

Install the `confer-a2a` plugin against a running gateway (the one you started above,
or any Confer instance you have an account on):

```
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer
```

Then set your credentials in the shell before launching Claude Code (the signing key
never leaves the gateway — the plugin only carries a bearer token):

```bash
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
# the one-command setup above is served by nginx on port 80, so point the plugin there:
export CONFER_GATEWAY_URL=http://localhost
# (the dev server in option 3 runs the gateway directly on :3000, which is the default)
```

Now just talk in Claude Code — it consults the contacts in your Confer account and
writes verified facts into project memory:

```
> Write Modbus temperature reading for X100
```

Plugin details and the 9 tools it exposes: [`plugins/confer-a2a/README.md`](./plugins/confer-a2a/README.md).

### 3. Develop locally

Run the infra in Docker and the gateway + client with hot reload:

```bash
bun install
docker compose up -d            # infra only: Postgres, Redis, NATS, Qdrant, MinIO
bun run db:migrate
bun run dev
```

- **Web preview**: open http://localhost:1420
- **Native desktop app**: `cd packages/client && bunx tauri dev`

Contributing, monorepo layout, and the test stack: **[`CONTRIBUTING.md`](./CONTRIBUTING.md)**.

## Architecture overview

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

## Documentation

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
| [`docs/09-deployment.md`](./docs/09-deployment.md) | Self-hosting, configuration, troubleshooting |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Developer setup, monorepo layout, test stack |

## Tech stack

- **Backend**: Bun + TypeScript + Hono
- **Client**: Tauri 2.0 + React 18 + TypeScript + Tailwind
- **Data**: PostgreSQL 16 + Redis + NATS + Qdrant + MinIO
- **Protocols**: W3C DID, HTTP Message Signatures (RFC 9421), MCP, A2A (Google), AgentFacts (NANDA)
- **LLM**: BYO key (Claude / GPT / DeepSeek / Qwen / Ollama)

## Status

🚧 **v0.1.0 released** — A2A consult flow, RFC 9421 HTTP signatures, DID:web identity, RAG knowledge base, and the `confer-a2a` Claude Code plugin are live. Remaining MVP work tracked in `docs/08-mvp-backlog.md`.

## License

TBD (considering Apache 2.0 or AGPL-3.0, depending on business strategy).
