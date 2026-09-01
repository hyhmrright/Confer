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
**with citations**, and can record what it learned as project memory your instance keeps,
so the next session starts from it instead of asking again.

The same channel works across organizations. When the other side runs an Agent too — a
vendor, a partner, another team — the two Agents talk to each other over a signed,
identity-verified protocol. Neither human reads the other's documentation.

<img src="./docs/assets/social/how-it-works.png" alt="How Confer works: Claude Code asks your Confer instance over MCP, which consults the peer Agent over signed A2A, and the cited answer comes back to the session" width="100%">

## Why it might interest you

- **It's useful with one node.** Point it at your own docs and your coding agent stops
  guessing. You don't need anyone else to join first.
- **Answers carry citations.** Every fact traces back to a source document, in its
  original language.
- **Knowledge outlives the session.** Facts and decisions you record about a peer are kept
  per project as plain Markdown on your own instance, and read back by name in a later
  session — they survive context windows and the machine you were sitting at.
- **No platform in the middle.** Built on open protocols: A2A, W3C DID:web, HTTP Message
  Signatures (RFC 9421), NANDA AgentFacts, MCP. Self-host it and federate with anyone.
- **Your keys stay yours.** LLM and embedding keys are AES-256-GCM encrypted per user and
  never leave the gateway.
- **Consent is a gate, not a formality.** Peers can't reach you until you accept them, and
  a three-tier permission model (L1/L2/L3) decides what an Agent may do unattended.

## Quick start

### 1 · Run your own instance

You need Docker, and Node 18+ for `npx`. Nothing to clone and nothing to build — this
pulls the published images, generates this instance's own secrets, applies migrations,
and waits until the web UI actually answers:

```bash
npx confer-cli
```

Open **http://localhost**, register the first account, then add your LLM API key in
**Settings** (stored encrypted, per user). `npx confer-cli down` stops everything and
keeps your data; `npx confer-cli logs` follows the gateway.

Everything it writes lives in `~/.confer`, and you should keep the `.env` there:
`ENCRYPTION_KEY` is what decrypts the API keys the instance stores, so losing it loses
them. Flags — port, image tag, install directory — are in
[the CLI's readme](https://www.npmjs.com/package/confer-cli).

<details>
<summary>No Node on the box? Plain Docker Compose does the same thing</summary>

```bash
curl -O https://raw.githubusercontent.com/hyhmrright/Confer/main/docker-compose.ghcr.yml
printf 'JWT_SECRET=%s\nENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env
docker compose -f docker-compose.ghcr.yml up -d
```

Same images, same compose file — it is the one the CLI ships. Two differences: nothing
verifies the stack actually came up, and the Postgres and MinIO passwords stay at the
file's defaults, so set `POSTGRES_PASSWORD` and `MINIO_ROOT_PASSWORD` in that `.env`
too unless the host is yours alone.

</details>

Images are built for linux/amd64 and linux/arm64 on every push to `main`. To build from
source instead, see [3 · Develop Confer itself](#3--develop-confer-itself).

**To talk to other instances, add a domain.** An agent's identity is a
[`did:web`](https://w3c-ccg.github.io/did-method-web/), and that resolves over HTTPS
only — so an instance on `localhost` or a bare IP publishes identities no peer can
verify, however well it works for its own users. Point a domain at the machine, open
ports 80 and 443, then:

```bash
npx confer-cli --domain confer.example.com
```

That fronts the stack with Caddy, which obtains and renews the certificate on its own,
and mints identities as `did:web:confer.example.com:agents:<user>`. It reports success
only once the domain actually answers over HTTPS, because that is the thing federation
depends on. Running from a clone instead: add `-f docker-compose.tls.yml` and set
`PUBLIC_HOST`.

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
docker compose up -d    # infra only: Postgres, Qdrant, MinIO
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
       [PostgreSQL · Qdrant · MinIO]
                 │
                 ▼
   External: LLM providers · MCP tool servers · Other instances' Agents
```

Details in [`docs/02-architecture.md`](./docs/02-architecture.md).

## Tech stack

- **Backend**: Bun + TypeScript + Hono
- **Client**: Tauri 2.0 + React 19 + TypeScript + Tailwind
- **Data**: PostgreSQL 18 + Qdrant + MinIO
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
| [`docs/07-project-memory.md`](./docs/07-project-memory.md) | Project memory, and the `.claude/peers/` git-committed form it is headed for (design) |
| [`docs/08-mvp-backlog.md`](./docs/08-mvp-backlog.md) | Roadmap and task checklist |
| [`docs/09-deployment.md`](./docs/09-deployment.md) | Self-hosting, configuration, troubleshooting |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Developer setup, monorepo layout, test stack |
| [`SECURITY.md`](./SECURITY.md) | Security policy and hardening notes |
| [`CLAUDE.md`](./CLAUDE.md) | For Claude Code: project conventions and entry points |

## Status

**v0.5.0 — working, pre-1.0, self-host only.**

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
