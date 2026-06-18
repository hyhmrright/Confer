# Contributing to Confer

Thanks for your interest in Confer — a protocol and platform for AI Agents to
communicate on behalf of their owners. This guide gets you from a fresh clone to a
running dev environment and explains how the codebase is laid out.

> Just want to *run* an instance, not change the code? See
> [`docs/09-deployment.md`](./docs/09-deployment.md).

## Local development setup

You need [Bun](https://bun.sh) ≥ 1.1 and Docker (Compose v2).

```bash
git clone https://github.com/hyhmrright/Confer.git
cd Confer
bun install                  # install all workspace deps
cp .env.example .env
docker compose up -d         # infra only: Postgres, Redis, NATS, Qdrant, MinIO
bun run db:migrate
bun run dev                  # gateway on :3000, client (Vite) on :1420
```

Open **http://localhost:1420** — Vite proxies `/api` to the gateway. For the native
desktop app: `cd packages/client && bunx tauri dev`.

## Monorepo layout

Bun workspaces under `packages/*`. Each package has one clear responsibility.

| Package | Purpose |
|---------|---------|
| `gateway` | Hono HTTP server — A2A endpoints, REST API, WebSocket, DB & middleware. `gateway/lib/` holds the RAG pipeline (MinIO storage, Qdrant search, multi-provider embedding). |
| `client` | Tauri 2.0 + React 18 desktop app — UI components, Zustand stores, Vite dev server. |
| `identity` | DID:web, HTTP Message Signatures (RFC 9421), crypto primitives, AgentFacts. |
| `agent-runtime` | LLM orchestration engine and policy enforcement. |
| `conversation` | Message bus (NATS) and conversation threading. |
| `shared` | Zod schemas, shared types, utility functions. |
| `mcp-a2a` | stdio MCP server that lets Claude Code consult peer Agents. Ships as the `confer-a2a` plugin (`plugins/confer-a2a/`). |

For how these fit together at runtime, read
[`docs/02-architecture.md`](./docs/02-architecture.md). The design docs
(`docs/01`–`docs/08`) are the source of truth for product scope, protocol, data
model, and API — read the relevant one before adding significant new logic.

## Common commands

```bash
bun run dev          # start all packages in dev mode
bun run build        # build all packages
bun run test         # run tests across all packages
bun run typecheck    # tsc --noEmit
bun run lint         # biome check
bun run lint:fix     # biome check --write
bun run db:generate  # generate a Drizzle migration from schema changes
bun run db:migrate   # apply generated migrations
```

## Testing

- **Unit tests** (`shared`, `identity`, `agent-runtime`, `conversation`, gateway
  `lib/`) are pure and need no infrastructure.
- **Gateway route tests** (`*.integration.test.ts`) drive the real Hono app via
  `app.request()` against a real Postgres + Qdrant + MinIO **test stack** — isolated
  from your dev data (project `confer-test`, ports 5433/6335/9002). Our own infra is
  real; external third parties (embedding API, LLM API, DID resolution) are mocked.

First run brings the stack up and builds the schema, then runs the suite:

```bash
bun run test:setup    # once: start the isolated test stack + build the test schema
bun run test
bun run test:stack:down   # tear the test stack down when finished
```

The harness preloads test env and truncates all tables between tests, so tests are
independent and order-insensitive.

## Conventions

- TypeScript everywhere. Named exports, `async`/`await`, no untyped `any`.
- Sentence-case headings; 2-space indent.
- Zod for all external input; ULID for IDs; `Result<T, E>` for expected failures.
- One responsibility per file: `kebab-case.ts`, `PascalCase.tsx`, migrations
  `NNNN_desc.sql`.
- Formatting and linting are enforced by Biome — run `bun run lint:fix` before
  committing.

### Contracts that must not break

1. A2A endpoints (`/a2a/v1/*`) require HTTP signature verification — never disable it.
2. DID documents must be valid W3C DID v1.0 (use the `did` library).
3. AgentFacts must validate against the NANDA schema.
4. Migration files are immutable once merged.
5. Never write SQL migrations by hand — always `bun run db:generate`. The journal
   won't track hand-written SQL and the schema drifts out of sync.
6. No plaintext secrets: passwords use Argon2id, stored keys use AES-256-GCM.
   LLM API keys never reach the client; signing private keys never leave the gateway.

## Submitting changes

1. Branch off `dev` into a `feat/*` or `fix/*` branch. `dev` is the everyday development branch.
2. Make focused commits; keep changes reviewable (prefer < ~300 lines per change).
3. Ensure `bun run lint`, `bun run typecheck`, and `bun run test` pass.
4. If you touch API, A2A, or MCP behavior, update the corresponding `docs/` file.
5. Open a pull request against `dev`. `main` is the protected release branch — it
   only receives `dev` via PR at release time, after which tags are cut from `main`.

## See also

- [`README.md`](./README.md) — project overview and quick start
- [`docs/09-deployment.md`](./docs/09-deployment.md) — self-hosting and deployment
- [`CLAUDE.md`](./CLAUDE.md) — conventions and entry points for Claude Code
