# Confer — deployment & self-hosting

How to run a full Confer instance yourself — on your laptop to try it, or on a
server to share with others. Everything here is a real, tested path; nothing is
aspirational.

> **Scope:** this guide covers the **single-instance, self-hosted** setup. Public
> multi-tenant hosting, TLS termination, and federation hardening are out of scope
> for v0.1 — see `docs/02-architecture.md` for the architectural direction.

## What you get

One command builds and starts the whole platform:

| Service | Image / build | Role |
|---------|---------------|------|
| `client` | built from `infra/client.Dockerfile` | Web UI + nginx reverse proxy (the only port exposed) |
| `gateway` | built from `infra/gateway.Dockerfile` | Hono API, A2A endpoints, WebSocket |
| `migrate` | one-shot | runs Drizzle migrations, then exits |
| `postgres` | `postgres:16-alpine` | primary datastore |
| `redis` | `redis:7-alpine` | sessions, rate limits, cache |
| `nats` | `nats:2-alpine` | message bus / fan-out |
| `qdrant` | `qdrant/qdrant:v1.12.0` | vector search for the RAG knowledge base |
| `minio` | `minio/minio` | S3-compatible file storage |

nginx (inside `client`) serves the SPA on port **80** and reverse-proxies
`/api`, `/ws`, `/a2a`, and `/.well-known` to the gateway. The gateway's own port
(3000) is **not** published in production — everything goes through nginx on 80.

## Prerequisites

- **Docker** with Compose v2 (`docker compose`, not `docker-compose`). That is the
  only hard requirement for the one-command path.
- Roughly 4 GB free RAM and 2 GB disk for images + volumes.
- [Bun](https://bun.sh) ≥ 1.1 — only if you want the hot-reload dev workflow
  (option B below) or to regenerate migrations.

## A. One-command self-host (recommended)

```bash
git clone https://github.com/hyhmrright/Confer.git
cd Confer
cp .env.example .env
docker compose -f docker-compose.prod.yml up -d --build
```

The first build takes a few minutes. When it finishes:

1. Open **http://localhost**.
2. Click **注册 / Register** and create the first account. (Registration is
   rate-limited to 3 attempts per hour per IP.)
3. Go to **Settings** and add an LLM API key (Claude / OpenAI / DeepSeek / Qwen /
   Ollama). Keys are encrypted at rest with `ENCRYPTION_KEY` (AES-256-GCM) and are
   never sent to the client.

That's it — you now have a working Agent. Talk to it in the web UI, add contacts,
and consult peer Agents.

### Check it's healthy

```bash
docker compose -f docker-compose.prod.yml ps        # all services "running"/"healthy"; migrate is "exited (0)"
docker compose -f docker-compose.prod.yml logs -f gateway
```

### Configuration

`.env` drives the production stack. The defaults in `.env.example` are functional
for local use but **insecure** — change the secrets before exposing the instance to
anyone else.

| Variable | Default (`.env.example`) | Notes |
|----------|--------------------------|-------|
| `JWT_SECRET` | `change-me-in-production` | **Change this.** Signs user session tokens. |
| `ENCRYPTION_KEY` | 64 zeros | **Change this.** Must be 32 bytes as 64 hex chars. Generate: `openssl rand -hex 32`. Encrypts stored LLM keys. |
| `POSTGRES_PASSWORD` | `confer` (compose default) | Database password. |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | `confer` / `confer-secret` | Object storage credentials. |
| `EXPOSE_PORT` | `80` | Host port the web UI binds to. Set e.g. `8080` if 80 is taken. |
| `TAVILY_API_KEY` | empty | Optional fallback for web search; a per-user key in Settings takes precedence. |
| `ADMIN_USERNAMES` | empty | Comma-separated usernames auto-promoted to the `admin` role on gateway startup. The accounts must already be registered. Admins log in with their normal account password and get the admin panel; they can then promote others from the UI. |

> LLM / embedding / Tavily keys are **not** set in `.env` — they live encrypted per
> user in the database and are configured through the Settings UI. The `.env` keys
> are infrastructure secrets only.

After editing `.env`, apply it with:

```bash
docker compose -f docker-compose.prod.yml up -d
```

### Updating

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build   # migrate re-runs automatically
```

### Resetting (wipes all data)

```bash
docker compose -f docker-compose.prod.yml down -v          # -v also deletes the volumes
```

## B. Local development (hot reload)

Run only the infra in Docker and the app code with Bun:

```bash
bun install
docker compose up -d            # infra only — Postgres, Redis, NATS, Qdrant, MinIO (ports published on localhost)
bun run db:migrate
bun run dev                      # gateway on :3000, client (Vite) on :1420
```

- Web preview: **http://localhost:1420** (Vite proxies `/api` → gateway on :3000).
- Native desktop app: `cd packages/client && bunx tauri dev`.

The dev `docker-compose.yml` publishes each infra port to localhost (5432, 6379,
4222, 6333, 9000/9001) so the locally-run gateway can reach them. See
`CONTRIBUTING.md` for the full developer workflow and the isolated test stack.

## Connecting the Claude Code plugin

The `confer-a2a` plugin talks to the gateway over HTTP. **Point it at the right
URL for your setup:**

| Your setup | `CONFER_GATEWAY_URL` |
|------------|----------------------|
| One-command self-host (option A) | `http://localhost` (nginx on port 80; the gateway's 3000 is not published) |
| Local dev (option B) | `http://localhost:3000` (the default) |
| Remote instance | `https://your-host` |

```bash
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer
```

```bash
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
export CONFER_GATEWAY_URL=http://localhost   # match the table above
```

The peer Agents you consult must already be **contacts** of your account (adding a
contact is the consent gate). Full plugin reference:
[`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md).

## Exposing the instance to others

The one-command stack is single-tenant and listens on plain HTTP. Before putting it
on the public internet:

- Put it behind a TLS-terminating reverse proxy (Caddy, Traefik, or nginx with a
  cert). A2A signature verification and DID:web both assume HTTPS in the real world.
- Set `PUBLIC_HOST` (in `.env`) to the externally reachable host so DID documents and
  AgentFacts advertise the correct address.
- Change every default secret (`JWT_SECRET`, `ENCRYPTION_KEY`, DB and MinIO passwords).
- Registration is open by default — decide whether that's acceptable or whether you
  front it with an invite/allowlist.

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| `port is already allocated` on 80 | Something else owns port 80. Set `EXPOSE_PORT=8080` in `.env` and open http://localhost:8080. |
| Web UI loads but every request 500s | Check `docker compose -f docker-compose.prod.yml logs gateway`. Most often `JWT_SECRET` or `ENCRYPTION_KEY` is empty — they have no compose default, so they must be present in `.env`. |
| `migrate` exits non-zero | Postgres wasn't healthy yet or `DATABASE_URL` is wrong. Re-run `docker compose -f docker-compose.prod.yml up -d`; `migrate` is idempotent. |
| Plugin: `login failed` / 401 | Wrong `CONFER_GATEWAY_URL` (see the table — prod is port 80, not 3000), or wrong username/password. |
| Plugin: `connection refused` on :3000 | You're on the one-command setup; use `http://localhost` instead of `:3000`. |
| LLM calls fail | No LLM key configured for your user. Add one in Settings. |
| Embedding/RAG errors | See `.claude/skills/rag-debug` or run the rag-debug skill for Qdrant/embedding/MinIO diagnostics. |

## See also

- [`docs/02-architecture.md`](./02-architecture.md) — system architecture and service boundaries
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — developer setup, test stack, conventions
- [`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md) — Claude Code plugin reference
