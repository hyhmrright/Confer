# CLAUDE.md

This file orients Claude Code when working in the Confer codebase. Read this first.

## Project: Confer

**One-line definition**: A protocol and platform for AI Agents to talk with each other on behalf of their owners — so users don't have to read each other's documentation.

**Hero use case**: Developer writing hardware integration code can have Claude Code consult the hardware vendor's AI Agent directly (via A2A protocol), get answers with citations to the vendor's docs, and sink the verified knowledge into the project (`.claude/peers/{vendor}/facts.md`) for reuse.

## Where to read what

| Need to know | Read |
|---|---|
| What we're building and why | `docs/01-product.md` |
| How the system fits together | `docs/02-architecture.md` |
| Agent-to-Agent protocol details | `docs/03-protocol.md` |
| Database schemas + types | `docs/04-data-model.md` |
| HTTP and WebSocket API surface | `docs/05-api.md` |
| Claude Code MCP plugin design | `docs/06-claude-code-plugin.md` |
| `.claude/peers/` format | `docs/07-project-memory.md` |
| What to build next + acceptance criteria | `docs/08-mvp-backlog.md` |

When in doubt about scope, default to **MVP scope (v0.1) in `docs/08-mvp-backlog.md`**.

## Tech stack

- **Language**: TypeScript everywhere (server: Bun runtime, client: Tauri WebView)
- **Backend framework**: Hono on Bun
- **Client**: Tauri 2.0 + React 18 + Tailwind CSS + Zustand
- **Database**: PostgreSQL 16 (main), Redis (cache/presence), Qdrant (vector), MinIO (S3-compatible)
- **Messaging**: NATS Streams
- **MCP**: `@modelcontextprotocol/sdk` (official TypeScript SDK)
- **Identity**: DID:web (W3C), HTTP Message Signatures (RFC 9421)
- **LLM**: User-supplied API keys to Anthropic / OpenAI / DeepSeek / Qwen / Ollama
- **Monorepo**: Bun workspaces

## Repo layout

```
confer/
├── CLAUDE.md
├── README.md
├── docs/                          # read these for design context
├── packages/
│   ├── shared/                    # shared types and schemas (library)
│   ├── gateway/                   # Edge API gateway (Bun + Hono) — the only runnable server
│   ├── agent-runtime/             # per-user Agent worker (library, consumed by gateway)
│   ├── conversation/              # messaging service (library, consumed by gateway)
│   ├── identity/                  # DID, AgentFacts, A2A gateway (library, consumed by gateway)
│   └── client/                    # Tauri 2.0 + React desktop/mobile app
├── infra/
│   ├── client.Dockerfile          # client container build
│   ├── gateway.Dockerfile         # gateway container build
│   └── nginx.conf                 # reverse proxy config
├── .github/workflows/
│   ├── ci.yml                     # typecheck + build on push/PR
│   └── release.yml                # multi-platform release builds
└── package.json                   # Bun workspaces root
```

> `packages/mcp-server` is planned but not yet created — see `docs/06-claude-code-plugin.md` for design.

## Coding conventions

- **Sentence case** in headings and labels — never Title Case, never ALL CAPS
- **2-space indent** in JavaScript/TypeScript files
- **Named exports** over default exports (better refactoring)
- **Zod schemas** for all external inputs (API bodies, WS messages, A2A payloads)
- **ULID** for all entity IDs (not UUID)
- **Async/await** over `.then()` chains
- **No `any` types** without an explicit reason in a comment
- **Errors as values**: return `Result<T, E>` style for expected failure paths; throw only for programmer errors
- **One responsibility per file**: don't merge controller + service + repository

## File naming

- `kebab-case.ts` for source files
- `kebab-case.test.ts` for tests
- `PascalCase.tsx` for React components
- Migration files: `NNNN_short_description.sql` (4-digit prefix)

## Common commands

```bash
bun install                # install all workspace dependencies
bun run dev                # start all services in parallel (gateway + client)
bun run build              # build all packages
bun run typecheck          # tsc --noEmit (backend; client excluded)
bun run lint               # biome check .
bun run lint:fix           # biome check --write .
bun run test               # run tests across all packages (bun test)
bun run db:generate        # generate drizzle migration (gateway)
bun run db:migrate         # run migrations (gateway)
```

Package-specific: `cd packages/<name> && bun test` or `bun run --filter @confer/<name> test`.

## Testing

- **Runner**: `bun test` (Bun's built-in test runner), colocated with source (`foo.ts` + `foo.test.ts`)
- **Integration** (planned): under `packages/{name}/integration-tests/`, use real Postgres via testcontainers
- **E2E** (planned): Playwright for client, custom HTTP test harness for backend
- Aim for **>80% coverage on services** (gateway, identity, agent-runtime)

## Important contracts to preserve

When making changes, do **not** break these without an explicit decision:

1. **All A2A endpoints under `/a2a/v1/*` require HTTP signature verification** — never disable for "testing"
2. **DID documents must be valid W3C DID v1.0** — use the `did` library, don't hand-roll JSON
3. **AgentFacts must validate against the NANDA schema** — even when we extend it
4. **Migration files are immutable once merged** — write a new migration to alter, never edit the old one
5. **Project memory format (`.claude/peers/*`) is human-readable Markdown** — never replace with binary or JSON; tools must work even when a human edited the files

## When generating code

- **Check `docs/` for design intent** before writing significant new logic
- **Read related existing code** before writing similar logic (look for patterns to follow)
- **Use existing libraries** for crypto, DID, HTTP signatures, MCP — these are subtle, don't hand-roll
- **For LLM provider calls**, go through the `LLMProvider` abstraction, never call provider SDKs directly from business logic
- **When adding API endpoints**, also update `docs/05-api.md`
- **When adding A2A protocol features**, also update `docs/03-protocol.md`
- **When adding tools to the MCP server**, also update `docs/06-claude-code-plugin.md`

## When the user asks for something outside MVP scope

- Don't silently expand scope
- Reference `docs/08-mvp-backlog.md` and ask if this is a v0.1 task or later
- If it's later, suggest a stub or fail-fast TODO with a tracking comment

## Forbidden

- ❌ Storing user passwords or LLM API keys in plaintext (use Argon2id for passwords; AES-256-GCM for keys)
- ❌ Sending LLM API keys to the client (server-side only)
- ❌ Disabling signature verification for any reason ("temp", "demo", etc.)
- ❌ Inline SQL strings (use the query builder; raw SQL only with explicit review)
- ❌ Auto-accepting L3 permissions on the user's behalf
- ❌ Logging full A2A request bodies (PII risk); log metadata only

## Common pitfalls

- The MCP SDK's tool schema validator is strict — test with a real Claude Code connection, not just unit tests
- `Bun.serve` WebSocket API differs from Node `ws` library — don't copy Node-era examples blindly
- HTTP message signatures cover specific headers — adding a header to a signed request invalidates the signature unless you include it in the signing set
- DID document caching is critical for performance — but stale caches cause auth failures; respect TTL and ETag
- Tauri 2.0 iOS support is newer than desktop — defer mobile-specific debugging until v0.3 milestone

## Versioning

- Backend services: semantic versioning, bump on breaking API changes
- Protocol (A2A, AgentFacts): URL versioning (`/a2a/v1/`, `/a2a/v2/`)
- Database schema: migration-numbered, never break-change in place
- Client: separate version, gated to compatible server versions

## Environment

Copy `.env.example` to `.env` and fill in required values before running. See `.env.example` for the full list (database URLs, API keys, etc.).

## CI

GitHub Actions runs on every push/PR to `main` and `dev`:

- **ci.yml**: `tsc --noEmit` (backend + client), Vite production build
- **release.yml**: multi-platform desktop/mobile builds with Tauri (triggered on version tags)

## Getting started locally

```bash
git clone <repo>
cd confer
bun install
cp .env.example .env       # fill in required values
bun run db:migrate          # requires a running PostgreSQL instance
bun run dev                 # gateway + client in parallel
```

Then open `http://localhost:1420` for the dev client.

> Infrastructure containers (Postgres, Redis, NATS, Qdrant, MinIO) are not yet orchestrated via docker-compose — provision them manually or point `.env` at existing instances.

## Questions to ask the user before deviating

- Should this be in v0.1 or later? (Check `docs/08-mvp-backlog.md`)
- Is this changing a protocol or API surface? (Then `docs/` must be updated too)
- Does this require schema migration? (Then a new migration file is mandatory)
- Does this introduce a new dependency? (Prefer to use existing libs first)
