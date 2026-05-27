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

### User perspective (install Claude Code plugin)

```bash
# Coming soon — package not yet published
claude mcp add confer npx -y @confer/mcp-server
# Claude Code will prompt for OAuth on first use
```

Then just talk in Claude Code:

```
> Write Modbus temperature reading for X100
```

Claude Code will automatically consult the registered ABC Industrial Agent and write verified facts into project memory.

### Developer perspective (local development)

```bash
git clone https://github.com/hyhmrright/Confer.git
cd Confer
bun install
docker compose up -d
bun run db:migrate
bun run dev
```

- **Web preview**: open http://localhost:1420 in a browser
- **Native desktop app**: `cd packages/client && bunx tauri dev`

### Self-hosted enterprise instance

```bash
docker compose -f docker-compose.prod.yml up -d
```

See the "Deployment architecture" section in `docs/02-architecture.md`.

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

## Tech stack

- **Backend**: Bun + TypeScript + Hono
- **Client**: Tauri 2.0 + React 18 + TypeScript + Tailwind
- **Data**: PostgreSQL 16 + Redis + NATS + Qdrant + MinIO
- **Protocols**: W3C DID, HTTP Message Signatures (RFC 9421), MCP, A2A (Google), AgentFacts (NANDA)
- **LLM**: BYO key (Claude / GPT / DeepSeek / Qwen / Ollama)

## Status

🚧 **v0.0.1 released** — initial platform scaffold (desktop + mobile builds). Core A2A features in progress per `docs/08-mvp-backlog.md`.

## License

TBD (considering Apache 2.0 or AGPL-3.0, depending on business strategy).
