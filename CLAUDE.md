## Project: Confer

A2A protocol platform for AI Agents to communicate on behalf of their owners.

## Commands

```bash
bun install                  # install all workspace deps
bun run dev                  # start all packages in dev mode
bun run build                # build all packages
bun run test                 # run tests across all packages
bun run typecheck            # tsc --noEmit
bun run lint                 # biome check
bun run lint:fix             # biome check --write
bun run db:generate          # generate Drizzle migration from schema changes
bun run db:migrate           # run gateway DB migrations (apply generated files)
bun run test:setup           # start isolated test stack + build test schema (run once before `bun run test`)
bun run test:stack:down      # tear down the isolated test stack
```

## Testing

- Unit tests (`shared`, `identity`, `agent-runtime`, `conversation`, gateway `lib/`) are pure and need no infra.
- Gateway **route** tests (`*.integration.test.ts`) drive the real Hono app (`app.ts`) via `app.request()` against a real Postgres + Qdrant + MinIO **test stack** (`docker-compose.test.yml`, project `confer-test`, ports 5433/6335/9002 — isolated from the dev/prod stack and its data). External third parties (embedding API, LLM API, DID resolution) are mocked; our own infra is real.
- First run: `bun run test:setup` (brings the stack up and builds the schema), then `bun run test`. The harness preloads test env (`src/test/setup.ts` via `bunfig.toml`) and truncates all tables between tests (`src/test/helpers.ts`).

## Architecture

Bun workspaces monorepo (`packages/*`):

| Package | Purpose |
|---------|---------|
| `gateway` | Hono HTTP server — A2A endpoints, REST API, WebSocket, DB/middleware |
| `client` | Tauri 2.0 + React 18 desktop app — UI components, stores, Vite dev on :1420 |
| `identity` | DID:web, HTTP signatures (RFC 9421), crypto, AgentFacts |
| `agent-runtime` | LLM orchestration engine, policy enforcement |
| `conversation` | Message bus (NATS), conversation threading |
| `shared` | Zod schemas, shared types, utility functions |
| `mcp-a2a` | stdio MCP server — lets Claude Code consult peer Agents; ships as the `confer-a2a` plugin (`plugins/confer-a2a/`) |
| `gateway/lib/` | RAG pipeline — MinIO file storage, Qdrant vector search, multi-provider embedding (OpenAI / GLM / Qwen) |

## Docs

Design context in `docs/` — files 01 (product) through 09 (deployment). Default to **MVP scope (v0.1)** per `docs/08-mvp-backlog.md`.

## Tech stack

TypeScript everywhere. Bun + Hono (server), Tauri 2.0 + React 18 + Zustand (client). PostgreSQL 16, Redis, NATS, Qdrant, MinIO. Bun workspaces monorepo. DID:web + RFC 9421. MCP: `@modelcontextprotocol/sdk`.

## Conventions

- Sentence case headings; 2-space indent; named exports; async/await; no untyped `any`
- Zod for external inputs; ULID for IDs; `Result<T,E>` for expected failures
- One responsibility per file: `kebab-case.ts`, `PascalCase.tsx`, migrations `NNNN_desc.sql`

## Contracts (do not break)

1. A2A endpoints (`/a2a/v1/*`) require HTTP signature verification — never disable
2. DID documents must be valid W3C DID v1.0 — use the `did` library
3. AgentFacts must validate against NANDA schema
4. Migration files are immutable once merged
5. `.claude/peers/*` must stay human-readable Markdown
6. Embedding provider auto-selected by the `EMBEDDING_PROVIDER_PRIORITY` constant in `lib/embedding.ts` (openai → glm → qwen) — first provider with a user-configured key wins

## Forbidden

- Plaintext passwords/API keys (Argon2id / AES-256-GCM)
- Sending LLM API keys to client
- Disabling signature verification
- Inline SQL (use query builder)
- Auto-accepting L3 permissions
- Logging full A2A request bodies (PII)

## Code generation rules

- Read `docs/` before significant new logic; read existing code for patterns
- Use existing libraries for crypto/DID/HTTP signatures/MCP; LLM calls via `LLMProvider`
- Adding/changing API, A2A, or MCP features → update corresponding `docs/` file
- Outside MVP scope → check `docs/08-mvp-backlog.md`, ask before expanding

## Release rules

Every release: merge to `main` first, then `git tag v* && git push origin v*` from main. Workflow rejects tags not reachable from `origin/main`. Run `.github/scripts/gen-release-notes.sh <tag>`, review draft, **translate ZH/JA sections** before publishing. Workflow auto-updates GitHub About + labels on finalize. Never publish untranslated placeholder text.

## Deployment

After completing any code change (post-review, pre-commit), redeploy the affected service so the effect is immediately visible at http://localhost/.

Determine which packages changed and run only the necessary steps:

| Changed package | Deploy command |
|----------------|----------------|
| `packages/client` only | `bun run build && docker compose -f docker-compose.prod.yml build client && docker compose -f docker-compose.prod.yml up -d client` |
| `packages/gateway` only | `bun run build && docker compose -f docker-compose.prod.yml build gateway && docker compose -f docker-compose.prod.yml up -d gateway` |
| both / unsure | `bun run build && docker compose -f docker-compose.prod.yml build gateway client && docker compose -f docker-compose.prod.yml up -d gateway client` |

Run from the repo root. Deployment happens **before** commit & push (not after).

**If the change includes a new migration**, also rebuild and re-run the `migrate` service — it is a *separate image* from `gateway` (same `infra/gateway.Dockerfile`), so `build gateway client` does **not** pick up new migration files. The stale `migrate` then runs the old set and still prints `Migrations complete`, leaving the new tables uncreated:
```
docker compose -f docker-compose.prod.yml build migrate && docker compose -f docker-compose.prod.yml run --rm migrate
```
Verify by querying the actual tables/columns (and the drizzle journal count), not by trusting the `Migrations complete` log line.

## Environment

Local infra via Docker: `docker compose up -d` starts PostgreSQL (5432), Redis (6379), NATS (4222), MinIO (9000/9001), Qdrant (6333). Copy `.env.example` to `.env` before first run. Gateway dev server on :3000, client Vite on :1420 (proxies `/api` to gateway).

## Pitfalls

- MCP SDK tool schema validator is strict — test with real Claude Code connection
- `Bun.serve` WebSocket API ≠ Node `ws`
- HTTP signatures: adding headers invalidates unless in signing set
- DID document caching: respect TTL/ETag or auth breaks
- Drizzle migrations: ALWAYS use `bun run db:generate`, never write SQL manually — the journal won't track it and schema gets out of sync requiring manual `ALTER TABLE` in prod (this bit us once: migrations 0002-0004 were hand-written and untracked; the journal was repaired by regenerating a tracked, idempotent `0002` from `schema.ts`)
- Qdrant point IDs must be UUID or uint64 — ULIDs are rejected with 400; convert via SHA-256 hash (`toUUID` in `lib/qdrant.ts`)
- Docker inter-container networking: use service names (`qdrant:6333`, `minio:9000`), not `localhost` — localhost resolves to the container itself
- LLM / embedding / Tavily keys live encrypted in `users.llm_keys_json` (AES-256-GCM via `ENCRYPTION_KEY`), set per-user via the settings UI — **not** in `.env`. The `TAVILY_API_KEY` env var is only a fallback; `web_search` is offered only when a key resolves
- Run tests as `bun run test`, never `bun test` — the bare form bypasses the `bunfig.toml` preload (test env + per-test truncation) and points at the shared **dev** DB. Blocked by `.claude/hooks/guard-bun-test.py`
- Any client file importing `@confer/shared` needs the alias in `packages/client/tsconfig.json` `paths` — the root tsconfig `exclude`s `packages/client`, and CI type-checks it separately (`npx tsc --noEmit` + `vite build` inside that dir). Local `node_modules` symlinks hide the breakage; only CI catches it
- In gateway, don't `mock.module` anything touching `getDb`/`getEnv` in unit tests — it pollutes the process globally and takes the real-stack integration tests down with it (this once caused 102 false failures). Test infra-touching code via integration tests instead

## Claude Code automation

`.claude/` ships project-specific automation — prefer it over manual steps:

- **Settings**: hooks live in tracked `.claude/settings.json` (shared by every checkout, paths via `$CLAUDE_PROJECT_DIR`); personal permissions and MCP toggles stay in `.claude/settings.local.json` (gitignored). Don't move hooks back into the local file — a fresh clone would silently lose every guard.
- **Hooks** (all in `.claude/hooks/`, each fails *open* so a bug can't wedge work): `post-edit-check.py` runs Biome + the owning package's `tsc` after every Edit/Write (client files route to `packages/client/tsconfig.json`) — no need to invoke lint/typecheck by hand. PreToolUse guards **block**: edits to Drizzle migration state (`packages/gateway/drizzle/*.sql` and `meta/_journal.json`) and to `.env*` (`guard-protected-files.py`), Bash `cat`/`head`/`tail`/`sed` used to *view* a file — use the Read tool (`guard-bash-file-view.py`; still allows `tail -f`, piping a viewer into another command, redirects/heredocs, `sed -i`), and bare `bun test` (`guard-bun-test.py`). All of them read the path/command from **`tool_input.*`** (nested). The earlier inline versions were silent no-ops twice over: they read a top-level `file_path`, *and* the migration one matched a `*/migrations/*` path this repo doesn't have (Drizzle's `out` is `packages/gateway/drizzle`). When you add a guard, prove it fires against a real path before trusting it.
- **Skills**: `deploy` (rebuild/redeploy, incl. the separate `migrate` image), `create-migration` (Drizzle migration + journal), `rag-debug` (Qdrant/embedding/MinIO diagnostics), `sync-env` (`.env` vs `.env.example`), `reset-user-password` (break-glass).
- **Agents**: `a2a-contract-reviewer` (A2A signature/DID/AgentFacts compliance), `migration-reviewer` (migration safety), `rag-pipeline-reviewer` (embedding priority, Qdrant point-id format, container networking, key handling).

There is no feature-development orchestrator here — the previous `confer-feature` skill and its architect/implementer/reviewer-qa trio were removed on 2026-08-01. Drive feature work directly, and delegate to the reviewers above by what changed. General-purpose review/simplification comes from installed plugins, not from this repo.
