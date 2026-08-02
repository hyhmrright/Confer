<div align="center">

<img src="./docs/assets/social/og.png" alt="Confer — Your AI confers, with anyone's" width="840">

**[Website](https://hyhmrright.github.io/Confer/)** · **[Docs](./docs)** · **[Claude Code plugin](./plugins/confer-a2a/README.md)** · **[Releases](https://github.com/hyhmrright/Confer/releases)**

[![Release](https://img.shields.io/github/v/release/hyhmrright/Confer?style=flat-square&color=e6a23c)](https://github.com/hyhmrright/Confer/releases)
[![License](https://img.shields.io/github/license/hyhmrright/Confer?style=flat-square&color=e6a23c)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/hyhmrright/Confer/ci.yml?branch=main&style=flat-square)](https://github.com/hyhmrright/Confer/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square)](./tsconfig.json)

English · [简体中文](./docs/i18n/README.zh-CN.md) · [日本語](./docs/i18n/README.ja.md)

</div>

---

## What it is

> **Your AI confers, with anyone's.**

Your coding agent doesn't know your internal systems, your team's conventions, or the
quirks of the third-party SDK you're integrating. So it guesses, and you spend your day
pasting documentation into a chat window.

**Confer gives that knowledge an address.** You run your own Agent — it holds your docs,
your knowledge base, and your rules. Claude Code consults it over MCP, gets an answer
**with citations**, and writes the verified facts into `.claude/peers/` where they travel
with git and get reused automatically.

The same channel works across organizations. When the other side runs an Agent too — a
vendor, a partner, another team — the two Agents talk to each other over a signed,
identity-verified protocol. Neither human reads the other's documentation.

<img src="./docs/assets/social/how-it-works.png" alt="How Confer works: Claude Code asks your Confer instance over MCP, which consults the peer Agent over signed A2A, and the cited answer is persisted to .claude/peers/" width="100%">

## Why it might interest you

- **It's useful with one node.** Point it at your own docs and your coding agent stops
  guessing. You don't need anyone else to join first.
- **Answers carry citations.** Every fact traces back to a source document, in its
  original language.
- **Knowledge outlives the session.** `.claude/peers/{peer}/facts.md` is plain Markdown,
  committed to your repo — it survives context windows, machines, and teammates.
- **No platform in the middle.** Built on open protocols: A2A, W3C DID:web, HTTP Message
  Signatures (RFC 9421), NANDA AgentFacts, MCP. Self-host it and federate with anyone.
- **Your keys stay yours.** LLM and embedding keys are AES-256-GCM encrypted per user and
  never leave the gateway.
- **Consent is a gate, not a formality.** Peers can't reach you until you accept them, and
  a three-tier permission model (L1/L2/L3) decides what an Agent may do unattended.

## Quick start

### 1 · Run your own instance

You need Docker. This builds the gateway and web client, runs migrations, and starts
everything:

```bash
git clone https://github.com/hyhmrright/Confer.git
cd Confer
cp .env.example .env    # defaults are fine locally — change the secrets before exposing it
docker compose -f docker-compose.prod.yml up -d --build
```

Open **http://localhost**, register the first account, then add your LLM API key in
**Settings** (stored encrypted, per user).

Configuration, reverse proxy, and troubleshooting: **[`docs/09-deployment.md`](./docs/09-deployment.md)**.

### 2 · Connect Claude Code

Install the `confer-a2a` plugin against the instance you just started:

```
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer
```

Set your credentials in the shell **before** launching Claude Code — the signing key never
leaves the gateway, the plugin only carries a bearer token:

```bash
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
export CONFER_GATEWAY_URL=http://localhost   # nginx serves the stack above on port 80
```

Then just work normally. Claude Code consults the contacts in your Confer account and
writes what it learns into project memory:

```
> Write Modbus temperature reading for the X100
```

The plugin and its tools: [`plugins/confer-a2a/README.md`](./plugins/confer-a2a/README.md).

### 3 · Develop Confer itself

Infra in Docker, gateway and client with hot reload:

```bash
bun install
docker compose up -d    # infra only: Postgres, Redis, NATS, Qdrant, MinIO
bun run db:migrate
bun run dev
```

- **Web preview**: http://localhost:1420
- **Native desktop app**: `cd packages/client && bunx tauri dev`

Monorepo layout, test stack, and conventions: **[`CONTRIBUTING.md`](./CONTRIBUTING.md)**.

## Architecture

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

Details in [`docs/02-architecture.md`](./docs/02-architecture.md).

## Tech stack

- **Backend**: Bun + TypeScript + Hono
- **Client**: Tauri 2.0 + React 18 + TypeScript + Tailwind
- **Data**: PostgreSQL 16 + Redis + NATS + Qdrant + MinIO
- **Protocols**: W3C DID, HTTP Message Signatures (RFC 9421), MCP, A2A, NANDA AgentFacts
- **LLM**: bring your own key (Claude · GPT · DeepSeek · Qwen · GLM · Ollama)

## Documentation

| Document | Content |
|---|---|
| [`docs/01-product.md`](./docs/01-product.md) | Product definition, target users, hero scenarios |
| [`docs/02-architecture.md`](./docs/02-architecture.md) | System architecture |
| [`docs/03-protocol.md`](./docs/03-protocol.md) | A2A, DID:web, AgentFacts, permission protocol |
| [`docs/04-data-model.md`](./docs/04-data-model.md) | Database schema, TypeScript types |
| [`docs/05-api.md`](./docs/05-api.md) | REST + WebSocket + A2A interfaces |
| [`docs/06-claude-code-plugin.md`](./docs/06-claude-code-plugin.md) | MCP plugin design |
| [`docs/07-project-memory.md`](./docs/07-project-memory.md) | `.claude/peers/` format |
| [`docs/08-mvp-backlog.md`](./docs/08-mvp-backlog.md) | Roadmap and task checklist |
| [`docs/09-deployment.md`](./docs/09-deployment.md) | Self-hosting, configuration, troubleshooting |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Developer setup, monorepo layout, test stack |
| [`SECURITY.md`](./SECURITY.md) | Security policy and hardening notes |
| [`CLAUDE.md`](./CLAUDE.md) | For Claude Code: project conventions and entry points |

## Status

**v0.3.1 — working, pre-1.0, self-host only.**

Shipped: A2A consult flow, RFC 9421 HTTP signatures, DID:web identity, RAG knowledge base
(MinIO + Qdrant + multi-provider embedding), agent long-term memory, three-tier
permissions, admin console, trilingual UI (EN/中文/日本語), and the `confer-a2a` Claude
Code plugin. Every PR runs the full test suite against a real Postgres + Qdrant + MinIO
stack.

Not there yet: no hosted public instance — you self-host. Desktop and mobile builds ship
per release but see less testing than the web client. Remaining scope is tracked in
[`docs/08-mvp-backlog.md`](./docs/08-mvp-backlog.md).

<img src="./docs/assets/screenshot-login.png" alt="Confer web client" width="100%">

## Contributing

Issues and PRs are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the dev setup
and [`good first issue`](https://github.com/hyhmrright/Confer/labels/good%20first%20issue)
for a place to start. Questions and ideas go in
[Discussions](https://github.com/hyhmrright/Confer/discussions).

Security issues: please follow [`SECURITY.md`](./SECURITY.md) rather than opening a public
issue.

## License

[Apache License 2.0](./LICENSE).
