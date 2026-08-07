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

Unit tests are pure (no infra). Gateway route tests (`*.integration.test.ts`) drive the real Hono app against a real Postgres + Qdrant + MinIO test stack (`docker-compose.test.yml`, isolated on ports 5433/6335/9002); embedding/LLM/DID calls are mocked. Run `bun run test:setup` once, then `bun run test`.

Client component tests (`packages/client/src/components/*.test.tsx`) render for real — `packages/client/bunfig.toml` preloads `src/test/setup-dom.ts` (happy-dom globals) and they drive components through `@testing-library/react`. Mock `../lib/api.js` (and `../lib/ws.js` for `ChatLayout`), matching the exact paths the stores call, longest prefix first — otherwise a store lands `undefined` in state and the component throws with no error boundary to catch it.

## Architecture

Bun workspaces monorepo (`packages/*`):

| Package | Purpose |
|---------|---------|
| `gateway` | Hono HTTP server — A2A endpoints, REST API, WebSocket, DB/middleware |
| `client` | Tauri 2.0 + React 19 desktop app — UI components, stores, Vite dev on :1420 |
| `identity` | DID:web, HTTP signatures (RFC 9421), crypto, AgentFacts |
| `agent-runtime` | LLM orchestration engine, policy enforcement |
| `shared` | Zod schemas, shared types, utility functions |
| `mcp-a2a` | stdio MCP server — lets an AI coding agent consult peer Agents; ships as the `confer-a2a` plugin (`plugins/confer-a2a/`) |
| `gateway/lib/` | Infrastructure adapters + cross-cutting gates — MinIO storage, Qdrant vector search, embedding (OpenAI / GLM / Qwen), `tenant.ts`, `a2a-admission.ts` |
| `gateway/orchestration/` | The LLM agent loop (`agent-orchestrator.ts`). Sits ABOVE `tools/`, which sits above `lib/` — keep that direction; `lib/` must never import `tools/` or `orchestration/` |

## Docs

Design context in `docs/` — files 01 (product) through 09 (deployment). Default to **MVP scope (v0.1)** per `docs/08-mvp-backlog.md`.

## Tech stack

TypeScript everywhere. Bun + Hono (server), Tauri 2.0 + React 19 + Zustand (client). PostgreSQL 16, Qdrant, MinIO. Bun workspaces monorepo. DID:web + RFC 9421. MCP: `@modelcontextprotocol/sdk`.

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

## Branching

`dev` is the daily working branch (unprotected — push directly). `main` is the release branch, protected by a GitHub **ruleset** (not classic protection — the `/protection` API returns 404). Feature branches and PRs target `dev`; releases go `dev` → `main`, then tag from `main`. CI `check` is the only required status.

CI runs `lint`, `typecheck`, `test` (spins up `docker-compose.test.yml` via `bun run test:setup`), `build`, and `audit` (`bun audit --audit-level=high`) in parallel; `check` is an aggregator job over those five, so it stays the single required context. **Never add a new gate to the ruleset** — add it to `check`'s `needs` instead, or PRs deadlock.

`audit` blocks, so a new high advisory turns the branch red. Fix it by upgrading — no advisory is exempted today. Only when no reachable fix exists may you add `--ignore=<GHSA-id>`, and the workflow comment must record why the vulnerable code path can't be hit. Bun's version is pinned in `.github/actions/setup/action.yml`, and every third-party action is SHA-pinned with the tag in a trailing comment.

Transitive advisories are usually a lockfile pinned below what the parent's own range already permits. Any re-resolve often lifts them on its own, so re-run `bun install` and re-audit before reaching for a root `package.json` `overrides` entry — and never hand-edit the lockfile. One moderate is genuinely upstream-blocked and stays: `drizzle-kit` still ships the deprecated `@esbuild-kit/esm-loader`, which hard-pins `esbuild ~0.18.20` (GHSA-67mh-4wv8-2f99, a dev-server issue drizzle-kit never triggers). It sits below the `high` gate, so it needs no `--ignore`.

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

Local infra via Docker: `docker compose up -d` starts PostgreSQL (5432), MinIO (9000/9001), Qdrant (6333). Copy `.env.example` to `.env` before first run. Gateway dev server on :3000, client Vite on :1420 (proxies `/api` to gateway).

## Pitfalls

- MCP SDK tool schema validator is strict — test with real Codex connection
- `Bun.serve` WebSocket API ≠ Node `ws`
- HTTP signatures: adding headers invalidates unless in signing set
- DID document caching: respect TTL/ETag or auth breaks
- Drizzle migrations: ALWAYS use `bun run db:generate`, never write SQL manually — the journal won't track it and schema gets out of sync requiring manual `ALTER TABLE` in prod (this bit us once: migrations 0002-0004 were hand-written and untracked; the journal was repaired by regenerating a tracked, idempotent `0002` from `schema.ts`)
- Qdrant point IDs must be UUID or uint64 — ULIDs are rejected with 400; convert via SHA-256 hash (`toUUID` in `lib/qdrant.ts`)
- Docker inter-container networking: use service names (`qdrant:6333`, `minio:9000`), not `localhost` — localhost resolves to the container itself
- `peer_agents` rows are globally unique by DID — one peer connected to several users shares a single row and a single `peer_id`. Any query scoped only by `peer_id` is **not** tenant-isolated; always add the owner constraint (`conversations.created_by` / `*.user_id`). This produced a real cross-tenant A2A thread injection, fixed in `1a4308b`. **The gates now live in `gateway/lib/tenant.ts`** (`isContact` / `assertIsContact` / `assertIsConversationParticipant` / `assertOwnsConversation`) — use them instead of re-writing the query inline, which is how the bug happened four separate times. Each takes an optional `db` handle: that is the injection seam, and it exists precisely because `mock.module`-ing `getDb` poisons the whole process (see below)
- The gateway is **single-instance by design**. WS connections (`ws/handler.ts`), A2A replay nonces (`lib/nonce-cache.ts`) and rate-limit counters (`middleware/rate-limit.ts`) are all process-local `Map`s. A second replica silently breaks A2A replay protection — the replay hits the other replica's empty nonce table and is accepted. Redis/NATS were removed from compose and `env.ts` on 2026-08-07 because nothing ever dialed them; don't re-add them as decoration. Scaling out means moving those three first, nonce foremost
- User-facing text belongs on the **client**, behind i18n. The gateway has no locale context, so anything it words itself reaches en/ja users in Chinese. `permission.request` therefore ships structured facts only (`@confer/shared`'s `permissionRequestEventSchema`) and `client/src/lib/permission-text.ts` renders the sentence. Strings sent to an **LLM** (tool descriptions, system prompts in `orchestration/` and `tools/`) are a different thing and stay where they are
- LLM / embedding / Tavily keys live encrypted in `users.llm_keys_json` (AES-256-GCM via `ENCRYPTION_KEY`), set per-user via the settings UI — **not** in `.env`. The `TAVILY_API_KEY` env var is only a fallback; `web_search` is offered only when a key resolves
- Run tests as `bun run test`, never `bun test` — the bare form bypasses the `bunfig.toml` preload (test env + per-test truncation) and points at the shared **dev** DB
- Any client file importing `@confer/shared` needs the alias in `packages/client/tsconfig.json` `paths` — the root tsconfig `exclude`s `packages/client`, and CI type-checks it separately (`npx tsc --noEmit` + `vite build` inside that dir). Local `node_modules` symlinks hide the breakage; only CI catches it
- In gateway, don't `mock.module` anything touching `getDb`/`getEnv` in unit tests — it pollutes the process globally and takes the real-stack integration tests down with it (this once caused 102 false failures). Test infra-touching code via integration tests instead
- Zod must resolve to **one** copy. `@modelcontextprotocol/sdk` accepts `^3.25 || ^4.0`, and bun will happily nest its own v3 alongside our v4 — the SDK's `AnySchema` then comes from a different `zod/v4/core` declaration and every `server.tool()` call fails to typecheck (51 errors, none of them in our code). The root `overrides.zod` entry fixes it, but only after `bun install --force`: a plain install leaves the stale nested resolution in the lockfile
- Zod 4 changed `.default()` to take the schema's **output** type. Anywhere the fallback is a raw input that must still run through parsing — `z.object({...}).default({})` relying on inner defaults, or `.transform(...).default('false')` — use `.prefault()` instead, which is the v3 behaviour. Also `z.record(v)` now requires the key type: `z.record(z.string(), v)`
- Zod 4 rewrote validation error text (`"Required"` → `"Invalid input: expected string, received undefined"`). That text ships to clients in `error.details`, so treat it as an API-visible string, not an internal detail
- TypeScript 7 no longer auto-collects `@types` from parent `node_modules`, and it errors on side-effect imports of non-TS files (TS2882). `packages/client/tsconfig.json` therefore declares `"types": ["bun", "vite/client"]` explicitly — dropping it breaks `bun:test` imports and `import './index.css'` even though the local symlinked install looks fine
- Every package must declare what it imports. `gateway` and `client` both `import ... from 'zod'` while declaring nothing, resolving it through the root devDependency — deleting that root entry broke CI's typecheck, build and test while local stayed green, because the stale hoisted `node_modules/zod` symlink was still lying around. Auditing dependencies is **two** questions, not one: declared-but-unused *and* used-but-undeclared. And any dependency removal must be re-verified after `rm -rf node_modules packages/*/node_modules && bun install` — a plain reinstall does not prune stale symlinks, so local resolution keeps working long after the declaration is gone
- Tailwind is v4: there is **no `tailwind.config.js`**. Theme lives in `@theme { --color-*: … }` inside `src/index.css`, custom classes use `@utility`, and PostCSS loads `@tailwindcss/postcss` (autoprefixer is built in and was removed). Biome needs `css.parser.tailwindDirectives` on or it fails to parse that file
