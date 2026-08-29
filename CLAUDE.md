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
- Client tests are of two kinds. Store/lib tests are pure logic. **Component tests (`src/components/*.test.tsx`) render for real**: `packages/client/bunfig.toml` preloads `src/test/setup-dom.ts`, which registers happy-dom globals, and they drive components through `@testing-library/react`. Mock `../lib/api.js` (and `../lib/ws.js` for `ChatLayout`) so nothing dials out — match the endpoint arms to the *exact* paths the stores call, longest prefix first, or a store lands `undefined` in state and the component throws with no error boundary to catch it.

## Architecture

Bun workspaces monorepo (`packages/*`):

| Package | Purpose |
|---------|---------|
| `gateway` | Hono HTTP server — A2A endpoints, REST API, WebSocket, DB/middleware |
| `client` | Tauri 2.0 + React 19 desktop app — UI components, stores, Vite dev on :1420 |
| `identity` | DID:web, HTTP signatures (RFC 9421), crypto, AgentFacts |
| `agent-runtime` | LLM orchestration engine, policy enforcement |
| `shared` | Zod schemas, shared types, utility functions |
| `mcp-a2a` | stdio MCP server — lets Claude Code consult peer Agents; ships as the `confer-a2a` plugin (`plugins/confer-a2a/`) |
| `cli` | `npx confer-cli` — the documented way to self-host. Plain Node (no Bun API), published to npm by hand; see Release rules |
| `gateway/lib/` | Infrastructure adapters + cross-cutting gates — MinIO storage, Qdrant vector search, embedding (OpenAI / GLM / Qwen), `tenant.ts`, `a2a-admission.ts` |
| `gateway/orchestration/` | The LLM agent loop (`agent-orchestrator.ts`). Sits ABOVE `tools/`, which sits above `lib/` — keep that direction; `lib/` must never import `tools/` or `orchestration/` |

## Docs

Design context in `docs/` — files 01 (product) through 09 (deployment). Default to **MVP scope (v0.1)** per `docs/08-mvp-backlog.md`.

## Tech stack

TypeScript everywhere. Bun + Hono (server), Tauri 2.0 + React 19 + Zustand (client). PostgreSQL 18, Qdrant, MinIO. Bun workspaces monorepo. DID:web + RFC 9421. MCP: `@modelcontextprotocol/sdk`.

## Conventions

- Sentence case headings; 2-space indent; named exports; async/await; no untyped `any`
- Zod for external inputs; ULID for IDs; `Result<T,E>` for expected failures
- One responsibility per file: `kebab-case.ts`, `PascalCase.tsx`, migrations `NNNN_desc.sql`
- Zustand: always subscribe with a selector (`useXStore((s) => s.field)`), never `useXStore()`. `setState` replaces the state object, so a selector-less read re-renders on *every* write to that store — see the pitfall below

## Contracts (do not break)

1. A2A endpoints (`/a2a/v1/*`) require HTTP signature verification — never disable
2. DID documents must be valid W3C DID v1.0 — use the `did` library
3. AgentFacts must validate against NANDA schema
4. Migration files are immutable once merged
5. `.claude/peers/*` must stay human-readable Markdown
6. Embedding provider auto-selected by the `EMBEDDING_PROVIDER_PRIORITY` constant in `lib/embedding.ts` (openai → glm → qwen → ollama) — first provider with a user-configured key wins. Ollama is last on purpose: it is the local fallback, so configuring a local chat model never takes embeddings away from a hosted key the owner already had. Its "key" is really a base URL (same slot-reuse as the chat provider) and `nomic-embed-text` returns 768 dimensions, which `toVectorSize` zero-pads to `VECTOR_SIZE` — padding leaves cosine similarity untouched, and points already carry the provider that produced them
7. Every LLM vendor is one entry in `packages/shared/src/llm/catalog.ts` — base URL, completions path, models path, wire shape, default model. Three packages read it: the gateway (key-slot whitelist and the `/models` proxy), agent-runtime (`createProvider`, which has no per-vendor code left), and the client's settings UI. Adding a vendor is that one entry; a base URL written anywhere else is a bug. Two things were learned the hard way and are load-bearing. **Model IDs are never hardcoded** — the client used to ship a curated list per provider and it named models like `deepseek-v4-pro` and `claude-opus-4-7` that no vendor has ever served; the list now always comes from the vendor's own `/models`, and a provider whose current IDs we cannot state simply carries no `defaultModel`. And **an empty model list always carries its reason** (`no_key` / `unauthorized` / `unreachable` / `unsupported`): all four used to collapse into `{models: []}`, which the UI read as "this provider has no models" and silently papered over with the hardcoded list. A local runtime's stored "key" is its base URL, so the listing goes to the address the owner configured — the gateway dials it, which is why `docker-compose.prod.yml` maps `host.docker.internal` and why the settings UI suggests that name rather than `localhost`


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

CI runs `lint`, `typecheck`, `test` (spins up `docker-compose.test.yml` via `bun run test:setup`), `build`, and `audit` (`bun audit --audit-level=high`) in parallel; `check` is an aggregator job over those five, so it stays the single required context. **Never add a new gate to the ruleset** — add it to `check`'s `needs` instead, or PRs deadlock. For the same reason, prefer a step in an existing job over a new job.

`lint` runs Biome over the repo, then **actionlint** over `.github/workflows/`, then **shellcheck** over `infra/*.sh` and `.github/scripts/*.sh` (both digest-pinned docker images), then a `Cargo.lock` freshness check over `packages/client/src-tauri`. None of the three is decoration: nothing else validates workflow syntax — a malformed `${{ }}` makes GitHub reject the file outright, zero jobs and an error naming no line, and a YAML parser can't see it because the file is still valid YAML — nothing else reads shell, which is what deploy, rollback and release-note generation are written in — and no other job touches Rust, so a `Cargo.toml` edit merged without a regenerated lockfile would surface only during a tagged release. All three ride in this job rather than jobs of their own, per the rule above.

`audit` blocks, so a new high advisory turns the branch red. Fix it by upgrading — no advisory is exempted today. Only when no reachable fix exists may you add `--ignore=<GHSA-id>`, and the workflow comment must record why the vulnerable code path can't be hit. A separate `audit.yml` re-runs the same command on a daily schedule, so an advisory published during a quiet week surfaces on its own instead of reddening the next unrelated commit; scheduled runs come from the default branch, so it watches `main` while `dev` stays covered by CI on every push. The Rust crate is audited beside it by `cargo audit` — a prebuilt binary from `taiki-e/install-action`, so no Rust toolchain is involved — in both `ci.yml` and `audit.yml`, so the two can't drift. It gates on vulnerabilities only: the 17 warnings it prints today are unmaintained gtk3/unic bindings that tauri pulls in, with nothing to upgrade to.

Bun's version is pinned in **two** places that must stay in step: `.github/actions/setup/action.yml` for CI, and `release.yml`'s top-level `env.BUN_VERSION` — the release jobs can't use that action because they also run on Windows, where its cache path doesn't apply. Every third-party action is SHA-pinned with the tag in a trailing comment.

The Tauri crate carries its own **`Cargo.lock`**, committed alongside `bun.lock`. It went untracked until 2026-08-24, so every release build re-resolved 469 crates from scratch: a tag was not reproducible, and an upstream patch release could have landed in a shipped binary with no diff to show for it. Regenerate it with `cargo generate-lockfile` inside `packages/client/src-tauri` whenever `Cargo.toml` changes, and commit it in the same change — cargo honours the lockfile by default, so no build flag is needed, but `lint` fails once the two have drifted. The *compiler* is still floating (`dtolnay/rust-toolchain` defaults to `stable`): the lock pins dependencies, not the toolchain.

Transitive advisories are usually a lockfile pinned below what the parent's own range already permits — but neither bun command you'd reach for first will lift one. A plain `bun install` honours the existing pin, and `bun update <pkg>` is **not** a re-resolve: for anything that isn't already a direct dependency it behaves like `bun add`, writing a fresh root `dependencies` entry at the latest major while leaving the transitive pin untouched (this happened with `nanoid`, which it "updated" to 6.0.1 in `dependencies` while `postcss` kept resolving 3.3.17). Go straight to a root `package.json` `overrides` entry, pinned to the major line the parent still accepts — `nanoid` stays on 3.x because `postcss` requires it and 4+ is ESM-only. Never hand-edit the lockfile; to undo a bad attempt, `git restore package.json bun.lock`. One moderate is genuinely upstream-blocked and stays: `drizzle-kit` still ships the deprecated `@esbuild-kit/esm-loader`, which hard-pins `esbuild ~0.18.20` (GHSA-67mh-4wv8-2f99, a dev-server issue drizzle-kit never triggers). It sits below the `high` gate, so it needs no `--ignore`.

Keeping any of this current is Dependabot's job rather than a person's: `.github/dependabot.yml` covers **bun** (not `npm` — that ecosystem cannot read `bun.lock`), **cargo**, **github-actions**, **docker-compose** and **docker**, grouped so a week arrives as a few PRs instead of twenty, all aimed at `dev`. The catch that made every line of it useless for its first seventeen days is worth internalising: **Dependabot reads that config, and GitHub schedules `audit.yml`, from the default branch only.** Both had been added on `dev`; `main` had not moved since 2026-08-02; so the config was never seen and the nightly audit never ran, while `bun outdated` and a green CI both reported that nothing was wrong. Any time `main` falls behind `dev`, every scheduled and background job in this repo stops silently — no warning exists for it. Two surfaces stay out of Dependabot's reach and need a human: the pins inside `.github/actions/setup/action.yml` (composite actions are a known dependabot-core gap, issues #6704 and #7495) and `oven/bun:1`, which floats on purpose.

A Dependabot PR bumping a **container image is not covered by its own green checks**, and the three that arrived on the first day made the point three different ways. CI runs `bun run build`, never `docker build`, and the test stack starts every service on an empty volume — so the checkmarks say nothing about whether the container starts or whether it can read the data already on disk. Verify by building the image and running it against a throwaway copy of the real thing: `alpine` 3.22→3.24 passed that (3.24 ships nginx 1.30.4 with a matching `nginx-mod-http-brotli`, and `brotli_static` still serves) and was merged; `postgres` 16→18 refuses to start on a PG16 data directory *and* moved its mount point to `/var/lib/postgresql`; `qdrant` v1.12→v1.19 panics on the older `segment.json`. Postgres majors are ignored in `.github/dependabot.yml` — a major is a `pg_upgrade` behind a maintenance window, never a merge — and `qdrant/qdrant` is excluded from the image group, because its breakage is *minor*-versioned and the majors-get-their-own-PR rule cannot see it. Both were then taken on 2026-08-29 as their own piece of work rather than a merge, and the stack now runs **postgres 18 / qdrant 1.19**: postgres moved by `pg_dumpall` and a restore onto a fresh volume mounted at `/var/lib/postgresql`, qdrant by scrolling every point out **with its vector** and upserting it back, which re-embeds nothing. `docs/09-deployment.md` carries the procedure; `npx confer-cli` probes for a 16 data directory before it starts anything, because the alternative is a container restarting in the background and the failure arriving three minutes later as a health-check timeout showing the gateway's logs and not postgres's. The ignore rules stay as they are — the next postgres major and the next qdrant minor will break in exactly the same way. The reassuring half of what was learned is that neither failure is silent: the postgres entrypoint recognises the old layout at *both* mount points and refuses to start rather than initialising an empty database beside it, which is the difference between a stopped instance and a lost one.

## Release rules

Every release: merge to `main` first, then `git tag v* && git push origin v*` from main. Workflow rejects tags not reachable from `origin/main`. Run `.github/scripts/gen-release-notes.sh <tag>`, review draft, **translate ZH/JA sections** before publishing. Workflow auto-updates GitHub About + labels on finalize. Never publish untranslated placeholder text.

`release.yml` is the one workflow CI cannot exercise — only a tag triggers it — so it has a rehearsal mode: dispatch it with an existing tag and `dry_run: true`, and it builds all four desktop targets and the Android APK, generates the notes, and publishes nothing (tauri-action treats an omitted `tagName`/`releaseName` as build-only). Run it after touching that file or any action it pins. One trap when editing those guards: GitHub's `a && b || c` yields `c` whenever `b` is falsy, and `''` is falsy — so the guard must read `!inputs.dry_run && value || ''` and never `inputs.dry_run && '' || value`, which would quietly hand back the real tag and cut a release in the middle of the rehearsal.

`packages/cli` — the `confer-cli` npm package the README now leads with — is published **by hand**. No workflow does it, no tag triggers it, and its version is its own rather than the app's. Two things follow. `prepack` copies the repo's `docker-compose.ghcr.yml` into the tarball, so edits to that file reach `npx confer-cli` users only when someone republishes the CLI; changing it and shipping nothing is a silent divergence between the repo and what people actually run. And verify a publish by running the published artifact, never by `npm publish`'s exit code: 0.3.1 shipped with a broken entry guard — `argv[1]` is the `node_modules/.bin/confer` symlink while `import.meta.url` is already resolved, so `main()` never ran and `npx confer-cli` did nothing at all while exiting 0. `packages/cli/src/index.test.ts` now builds the bundle, symlinks it the way npm does and runs it under plain `node`, which is the only way that guard can be exercised at all.

## Deployment

After completing any code change (post-review, pre-commit), redeploy the affected service so the effect is immediately visible at http://localhost/.

Determine which packages changed and run only the necessary steps:

| Changed package | Deploy command |
|----------------|----------------|
| `packages/client` only | `./infra/deploy.sh client` |
| `packages/gateway` only | `./infra/deploy.sh gateway` |
| both / unsure | `./infra/deploy.sh` |

Run from the repo root. Deployment happens **before** commit & push (not after).

`deploy.sh` runs `bun run build`, rebuilds those images and restarts them, but first re-tags the image each service is about to replace as `:previous` — `docker compose build` overwrites `:latest` in place, so the outgoing image otherwise loses its name and the next prune reclaims it, which is how this stack spent its whole life with no way back from a bad deploy. `./infra/rollback.sh [service...]` undoes one by pointing `:latest` back at `:previous` and recreating the containers. It reverts **code only**: migrations are forward-only, so rolling an image back does not undo a migration that deploy applied. Both scripts read image names out of `docker-compose.prod.yml`, where they are declared explicitly rather than derived from compose's `<project>-<service>` rule.

`deploy.sh` builds without `--pull`, and both Dockerfiles sit on the floating `oven/bun:1` tag, so a cached base image keeps whatever Bun it was pulled with. **Raising the Bun version therefore needs `docker pull oven/bun:1` first**, or the containers ship the old runtime against a lockfile the new one generated — silently, because `bun install --frozen-lockfile` still succeeds across a minor. Verify with `docker compose -f docker-compose.prod.yml exec gateway bun --version`, not by reading the Dockerfile.

That cached base is also what hides a **new** Bun breaking the Dockerfile, which is worse than shipping an old one and is not hypothetical: Bun 1.4 stopped hoisting workspace dependencies to the root `node_modules` and now installs each package's own as symlinks into a root `.bun` store, so the release stage's `COPY --from=install /app/node_modules` stopped carrying the dependencies at all and neither gateway nor migrate could resolve `drizzle-orm`. Every local image had been built against a cached pre-1.4 base, and CI runs `bun run build` and never `docker build`, so the repo looked green for the thirteen days the README's quick start was failing for anyone who cloned it. After pulling a new base, **build the images and start them** — `docker compose build && up`, then check the containers are actually `running` and a migration actually applies. A version string proves the runtime changed, not that the image works.

**If the change includes a new migration**, also rebuild and re-run the `migrate` service — it is a *separate image* from `gateway` (same `infra/gateway.Dockerfile`), so `build gateway client` does **not** pick up new migration files. The stale `migrate` then runs the old set and still prints `Migrations complete`, leaving the new tables uncreated:
```
docker compose -f docker-compose.prod.yml build migrate && docker compose -f docker-compose.prod.yml run --rm migrate
```
Verify by querying the actual tables/columns (and the drizzle journal count), not by trusting the `Migrations complete` log line.

## Environment

Local infra via Docker: `docker compose up -d` starts PostgreSQL (5432), MinIO (9000/9001), Qdrant (6333). Copy `.env.example` to `.env` before first run. Gateway dev server on :3000, client Vite on :1420 (proxies `/api` to gateway).

## Pitfalls

- MCP SDK tool schema validator is strict — test with real Claude Code connection
- `Bun.serve` WebSocket API ≠ Node `ws`
- HTTP signatures: adding headers invalidates unless in signing set
- DID document caching: respect TTL/ETag or auth breaks
- Drizzle migrations: ALWAYS use `bun run db:generate`, never write SQL manually — the journal won't track it and schema gets out of sync requiring manual `ALTER TABLE` in prod (this bit us once: migrations 0002-0004 were hand-written and untracked; the journal was repaired by regenerating a tracked, idempotent `0002` from `schema.ts`)
- Qdrant point IDs must be UUID or uint64 — ULIDs are rejected with 400; convert via SHA-256 hash (`toUUID` in `lib/qdrant.ts`)
- Docker inter-container networking: use service names (`qdrant:6333`, `minio:9000`), not `localhost` — localhost resolves to the container itself
- `peer_agents` rows are globally unique by DID — one peer connected to several users shares a single row and a single `peer_id`. Any query scoped only by `peer_id` is **not** tenant-isolated; always add the owner constraint (`conversations.created_by` / `*.user_id`). This produced a real cross-tenant A2A thread injection, fixed in `1a4308b`. **The gates now live in `gateway/lib/tenant.ts`** (`isContact` / `assertIsContact` / `assertIsConversationParticipant` / `assertOwnsConversation`) — use them instead of re-writing the query inline, which is how the bug happened four separate times. Each takes an optional `db` handle: that is the injection seam, and it exists precisely because `mock.module`-ing `getDb` poisons the whole process (see below)
- **A2A federation needs HTTPS, not as hardening but as the mechanism.** `did:web` resolution is https-only (`parseDidWeb` always builds `https://`), so an instance on `localhost` or a bare IP publishes identities no peer can resolve — inbound A2A dies at `did_resolution_failed` before the signature is examined. `docker-compose.tls.yml` is the overlay that fixes it (Caddy, automatic certificates, `PUBLIC_HOST` = bare domain); `npx confer-cli --domain <name>` and `CONFER_DOMAIN=<name>` in `oracle-bootstrap.sh` are the same thing from the two self-host paths. The overlay uses `ports: !override []` on `client` because compose MERGES sequences — a bare `ports: []` would leave the base mapping and collide with Caddy on 80. The `caddy` image declares no ENTRYPOINT, so `command` must start with `caddy`
- **Bun closes an idle connection after 10 seconds by default**, and both long-lived responses here are silent for longer: an SSE turn writes nothing until the model's first token, and the consult long-poll waits up to 55s by design. `index.ts` sets `idleTimeout: 255` (Bun's maximum). The symptom is misleading enough to be worth naming — the gateway's own log prints a clean `200`, nginx returns a bare 502, and each looks like the other's fault; isolate by issuing the same request from **inside** the gateway container. nginx's `/api/` block also needs `proxy_buffering off` + a raised `proxy_read_timeout` + HTTP/1.1, or tokens arrive in one lump and anything past 60s is cut anyway
- **`GET /api/v1/stream/:conv/:msg` calls the model and writes a row.** Requesting it twice for one message bought two completions and appended two answers (reproduced live, 25s apart) — a reload, a flaky connection or a second tab was enough. It now takes a process-local claim on the message id **before** reading for an existing reply: the obvious order loses to a turn that finishes and releases in between. Claims carry a TTL because no LLM call has a timeout — a hung provider would otherwise wedge that message forever, with no reply row to replay and every retry declined
- **One A2A peer reaches you under two DIDs**, and which one you hold depends on how the contact was added. `from` and `/.well-known/agents.json` carry the AGENT did (`<owner>:agent`); the only DID that *resolves*, and the one the UI shows behind a copy button, is the owner's. So `to` accepts either (`findTargetAgent`), and peer lookup accepts `from` **or the verified signer DID** (`ensurePeerAgent`) — matching one alone made a contact added from a pasted DID 404, and turned the peer's own reply into a connection request from a stranger. Relatedly, a reply must echo the **asker's** `thread_id`: thread ids are per-side, `resolveOrCreateThread` correctly refuses a thread the caller doesn't own, and replying with ours filed the answer under a new conversation while the asker polled theirs — every consult sat at `pending` next to a good answer on both machines. `messages.thread_root` is `char(26)` for our own ULIDs: store the local conversation id, never the peer's raw value, which any peer could overflow into a 500. The receiving side needs the mirror of that rule: a thread id you don't recognise is not "no thread", it is *their* numbering, so derive the local conversation id from it (`derivedId('a2a-thread', ownerId, peerId, theirThreadId)`) instead of minting a new one. Treating it as absent opened a fresh conversation per inbound message — no history, and the owner's list full of one-line threads. Deriving also removes the create-race and needs no column; only the LAST part of a derived id may be variable-width or attacker-supplied, since `:` is not escaped
- **A column with no way to set it is a dead feature, not a default.** `agents.is_public` had a schema column, an API field and two read paths, and nothing in the product ever wrote it — so `/.well-known/agents.json` was empty on every instance and search by name matched nobody, which made adding a contact impossible and A2A, consult and errands unreachable behind it. When auditing, ask of every gate: *what writes this?*
- **An agent with nothing configured is a misconfiguration, not an auth failure.** Both turn paths defaulted the provider name to a hardcoded `'anthropic'`, so an agent whose owner never opened the settings tab dialled a vendor they have no key for and came back `401` — naming a company the owner may never have heard of. `lib/agent-model.ts` (`resolveAgentModel`) is now the single answer to "what does this agent run on", returning a machine code (`no_model_configured` / `unknown_provider` / `no_key_for_provider`) that the client words. A `keyIsBaseUrl` provider is exempt from the key check: a local runtime's empty slot means the catalogue's default address, not a missing credential
- **On A2A, a failure that only logs is indistinguishable from one still in progress.** An answering side that logged and returned left the asker's `/consult/{id}/reply` long-poll running to its deadline and reporting `pending` — forever, on every retry. Every path that cannot produce an answer now sends the asker a `type: 'notification'` carrying the reason in `context.error` (`notification` because only a `question` provokes a reply, so it cannot loop). English prose rides in `content` as the fallback: the peer is another instance and does not share our locale, which is why the code, not the sentence, is the contract
- **Qdrant applies a write asynchronously unless you ask it not to.** Upserts carried `?wait=true` and deletes did not, so a deleted memory or document stayed searchable after its API call returned 200 — and the suite failed on any second local run, because the collection was then big enough for the write to lag. Symptom to recognise: a delete test that passes on an empty store and fails on a used one
- **A gateway resolves its own DIDs from its own database** (`lib/did-resolution.ts`), never over the network. Fetching them back failed on every `PUBLIC_HOST=localhost` install (https vs. the http nginx serves) and is fragile behind NAT; answering locally is also stricter, since nobody controlling DNS can substitute a key for one of our own accounts. It mirrors exactly the two documents we publish — `/.well-known/did.json` and `/agents/<username>/did.json` — and reports anything else under our authority as not found rather than fetching our own 404. Use `resolveDidDocument`, not `resolveDID`, anywhere the DID might be ours
- **Outbound A2A signs with the OWNER's key** (`owner_type: 'user'`, keyed by user id) because that is the only key registration mints and the only one `/agents/<username>/did.json` publishes. It queried `owner_type: 'agent'` until 2026-08-29 — a row nothing has ever written — so every consult and every A2A reply failed with `no_signing_key`. The one test covering it hand-seeded that row, which is the general lesson: **a fixture that invents a shape production cannot produce tests nothing.** Drive identity-adjacent tests through the real registration route
- The gateway is **single-instance by design**. WS connections (`ws/handler.ts`), A2A replay nonces (`lib/nonce-cache.ts`) and rate-limit counters (`middleware/rate-limit.ts`) are all process-local `Map`s. A second replica silently breaks A2A replay protection — the replay hits the other replica's empty nonce table and is accepted. Redis/NATS were removed from compose and `env.ts` on 2026-08-07 because nothing ever dialed them; don't re-add them as decoration. Scaling out means moving those three first, nonce foremost
- User-facing text belongs on the **client**, behind i18n. The gateway has no locale context, so anything it words itself reaches en/ja users in Chinese. `permission.request` therefore ships structured facts only (`@confer/shared`'s `permissionRequestEventSchema`) and `client/src/lib/permission-text.ts` renders the sentence. Strings sent to an **LLM** (tool descriptions, system prompts in `orchestration/` and `tools/`) are a different thing and stay where they are
- LLM / embedding / Tavily keys live encrypted in `users.llm_keys_json` (AES-256-GCM via `ENCRYPTION_KEY`), set per-user via the settings UI — **not** in `.env`. The `TAVILY_API_KEY` env var is only a fallback; `web_search` is offered only when a key resolves
- Run tests as `bun run test`, never `bun test` — the bare form bypasses the `bunfig.toml` preload (test env + per-test truncation) and points at the shared **dev** DB. Blocked by `.claude/hooks/guard-bun-test.py`
- Any client file importing `@confer/shared` needs the alias in `packages/client/tsconfig.json` `paths` — the root tsconfig `exclude`s `packages/client`, and CI type-checks it separately (`npx tsc --noEmit` + `vite build` inside that dir). Local `node_modules` symlinks hide the breakage; only CI catches it
- In gateway, don't `mock.module` anything touching `getDb`/`getEnv` in unit tests — it pollutes the process globally and takes the real-stack integration tests down with it (this once caused 102 false failures). Test infra-touching code via integration tests instead
- Zod must resolve to **one** copy. `@modelcontextprotocol/sdk` accepts `^3.25 || ^4.0`, and bun will happily nest its own v3 alongside our v4 — the SDK's `AnySchema` then comes from a different `zod/v4/core` declaration and every `server.tool()` call fails to typecheck (51 errors, none of them in our code). The root `overrides.zod` entry fixes it, but only after `bun install --force`: a plain install leaves the stale nested resolution in the lockfile
- Zod 4 changed `.default()` to take the schema's **output** type. Anywhere the fallback is a raw input that must still run through parsing — `z.object({...}).default({})` relying on inner defaults, or `.transform(...).default('false')` — use `.prefault()` instead, which is the v3 behaviour. Also `z.record(v)` now requires the key type: `z.record(z.string(), v)`
- Zod 4 rewrote validation error text (`"Required"` → `"Invalid input: expected string, received undefined"`). That text ships to clients in `error.details`, so treat it as an API-visible string, not an internal detail
- TypeScript 7 no longer auto-collects `@types` from parent `node_modules`, and it errors on side-effect imports of non-TS files (TS2882). `packages/client/tsconfig.json` therefore declares `"types": ["bun", "vite/client"]` explicitly — dropping it breaks `bun:test` imports and `import './index.css'` even though the local symlinked install looks fine
- Every package must declare what it imports. `gateway` and `client` both `import ... from 'zod'` while declaring nothing, resolving it through the root devDependency — deleting that root entry broke CI's typecheck, build and test while local stayed green, because the stale hoisted `node_modules/zod` symlink was still lying around. Auditing dependencies is **two** questions, not one: declared-but-unused *and* used-but-undeclared. And any dependency removal must be re-verified after `rm -rf node_modules packages/*/node_modules && bun install` — a plain reinstall does not prune stale symlinks, so local resolution keeps working long after the declaration is gone
- Tailwind is v4: there is **no `tailwind.config.js`**. Theme lives in `@theme { --color-*: … }` inside `src/index.css`, custom classes use `@utility`, and PostCSS loads `@tailwindcss/postcss` (autoprefixer is built in and was removed). Biome needs `css.parser.tailwindDirectives` on or it fails to parse that file
- The client image is **Alpine's nginx**, not `nginx:alpine`. Brotli is a dynamic module and only Alpine's repo ships one built against a matching nginx; nginx.org's module set (which the official image uses) has none. Two consequences: the server block lives in `/etc/nginx/http.d/`, not `conf.d/`, and reverting the base image makes `brotli_static` an **unknown directive**, which is fatal — the container will not start at all. `infra/client.Dockerfile` precompresses every js/css/html/svg/json/txt in `dist` with brotli -11 and gzip -9 at build time; `brotli_static`/`gzip_static` serve those and fall back to the plain file on their own, so the two can never disagree about `Content-Encoding`
- Locale resources are dynamically imported per language (`src/i18n/index.ts`), and i18next no longer initialises on import — `main.tsx` awaits `initI18n()` and tests get it from `src/test/setup-dom.ts`. Switch languages via the exported `changeLanguage`, never `i18n.changeLanguage`, which would announce the switch before the bundle exists. Two non-obvious constraints: the `import()` specifiers must be written out literally (a computed one makes Rollup bundle all three back in), and `main.tsx` must use `.then()` rather than a **top-level await** — awaiting makes the entry an async module, and Rollup responds by hoisting shared modules into separate chunks, which fragmented the login path into five files and cost more in lost compression context than the split saved
- `zod/mini` is **not** a bundle win here, measured: converting the client's schemas made the chunk 1.7 KB *bigger*. The 69 KB that zod contributes is almost entirely `zod/v4/core`, which mini needs too — only dropping zod outright would recover it, at the cost of hand-rolled validation of untrusted socket frames

## Claude Code automation

`.claude/` ships project-specific automation — prefer it over manual steps:

- **Settings**: hooks live in tracked `.claude/settings.json` (shared by every checkout, paths via `$CLAUDE_PROJECT_DIR`); personal permissions and MCP toggles stay in `.claude/settings.local.json` (gitignored). Don't move hooks back into the local file — a fresh clone would silently lose every guard.
- **Hooks** (all in `.claude/hooks/`, each fails *open* so a bug can't wedge work): `post-edit-check.py` runs Biome + the owning package's `tsc` after every Edit/Write (client files route to `packages/client/tsconfig.json`) — no need to invoke lint/typecheck by hand. PreToolUse guards **block**: edits to Drizzle migration state (`packages/gateway/drizzle/*.sql` and `meta/_journal.json`) and to `.env*` (`guard-protected-files.py`), Bash `cat`/`head`/`tail`/`sed` used to *view* a file — use the Read tool (`guard-bash-file-view.py`; still allows `tail -f`, piping a viewer into another command, redirects/heredocs, `sed -i`), and bare `bun test` (`guard-bun-test.py`). All of them read the path/command from **`tool_input.*`** (nested). The earlier inline versions were silent no-ops twice over: they read a top-level `file_path`, *and* the migration one matched a `*/migrations/*` path this repo doesn't have (Drizzle's `out` is `packages/gateway/drizzle`). When you add a guard, prove it fires against a real path before trusting it.
- **Skills**: `deploy` (rebuild/redeploy, incl. the separate `migrate` image), `create-migration` (Drizzle migration + journal), `rag-debug` (Qdrant/embedding/MinIO diagnostics), `sync-env` (`.env` vs `.env.example`), `reset-user-password` (break-glass).
- **Agents**: `a2a-contract-reviewer` (A2A signature/DID/AgentFacts compliance), `migration-reviewer` (migration safety), `rag-pipeline-reviewer` (embedding priority, Qdrant point-id format, container networking, key handling).

There is no feature-development orchestrator here — the previous `confer-feature` skill and its architect/implementer/reviewer-qa trio were removed on 2026-08-01. Drive feature work directly, and delegate to the reviewers above by what changed. General-purpose review/simplification comes from installed plugins, not from this repo.
