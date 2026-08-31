# Confer — deployment & self-hosting

How to run a full Confer instance yourself — on your laptop to try it, or on a
server to share with others. Everything here is a real, tested path; nothing is
aspirational.

> **Scope:** this guide covers the **single-instance, self-hosted** setup, with or
> without TLS ([Serving HTTPS](#serving-https)). Public multi-tenant hosting and
> federation hardening are out of scope for v0.1 — see `docs/02-architecture.md` for
> the architectural direction.

## What you get

One command starts the whole platform:

| Service | Image / build | Role |
|---------|---------------|------|
| `client` | built from `infra/client.Dockerfile` | Web UI + nginx reverse proxy (the only port exposed) |
| `gateway` | built from `infra/gateway.Dockerfile` | Hono API, A2A endpoints, WebSocket — **single replica, see below** |
| `migrate` | one-shot | runs Drizzle migrations, then exits |
| `postgres` | `postgres:18-alpine` | primary datastore |
| `qdrant` | `qdrant/qdrant:v1.19.0` | vector search for the RAG knowledge base |
| `minio` | `minio/minio` | S3-compatible file storage |

> **Do not scale `gateway` past one replica.** WebSocket connections, A2A replay
> nonces and rate-limit counters live in that process's memory. A second replica
> would accept replayed A2A requests (its nonce table is empty), miss WS pushes
> for users connected to the other replica, and multiply rate limits by the
> replica count. See `docs/02-architecture.md` for what has to move first.

nginx (inside `client`) serves the SPA on port **80** and reverse-proxies
`/api`, `/ws`, `/a2a`, and `/.well-known` to the gateway. The gateway's own port
(3000) is **not** published in production — everything goes through nginx on 80.

## Prerequisites

- **Docker** with Compose v2 (`docker compose`, not `docker-compose`). The only hard
  requirement.
- **Node 18+** — only for `npx confer-cli` (option A). The plain-Compose path, also
  under A, does without it.
- Roughly 4 GB free RAM and 2 GB disk for images + volumes.
- [Bun](https://bun.sh) ≥ 1.1 — only if you want the hot-reload dev workflow
  (option C below) or to regenerate migrations.

## A. Published images (recommended)

Nothing to clone, nothing to build:

```bash
npx confer-cli
```

[`confer-cli`](https://www.npmjs.com/package/confer-cli) refuses to start unless Docker
is actually running, writes `docker-compose.ghcr.yml` and a `0600` `.env` into
`~/.confer` — `JWT_SECRET`, `ENCRYPTION_KEY` and the database and object-store
passwords, all generated with `crypto.randomBytes` on first run and then reused — pulls
the images, applies migrations, and polls `/health` for up to three minutes. It reports
success when a page is served, not when containers start; if that never happens it
prints the last 40 lines of the `migrate` and `gateway` logs. `npx confer-cli down`
stops everything and keeps the data, `npx confer-cli logs` follows the gateway.

Flags: `--port` (default 80), `--dir` (default `~/.confer`), `--version` (image tag),
`--project` (compose project name). If a compose project named `confer` already exists
and this CLI did not create it, the CLI stops rather than adopt it — compose volumes are
keyed by project name, so starting would point these images at that stack's database.

The same thing by hand, for a host without Node:

```bash
curl -O https://raw.githubusercontent.com/hyhmrright/Confer/main/docker-compose.ghcr.yml
printf 'JWT_SECRET=%s\nENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env
docker compose -f docker-compose.ghcr.yml up -d
```

That leaves `POSTGRES_PASSWORD` and `MINIO_ROOT_PASSWORD` at the compose file's
defaults (`confer` / `confer-secret`), which the CLI would have randomised. Neither port
is published, so it is not a hole on a single-tenant box — but set both in `.env` on any
host you share.

`ghcr.io/hyhmrright/confer-gateway` and `-client` are built for linux/amd64 and
linux/arm64 on every push to `main`, and tagged `latest`, the commit SHA, and the
release version. Pin one with `CONFER_VERSION` in `.env`.

Unlike `docker-compose.prod.yml`, this file runs `migrate` and `gateway` from the
*same* image. That is only safe because nothing is built here — see the warning
under option B, which is where the two can drift apart.

Then open **http://localhost**, register the first account, and add an LLM API key
in **Settings** — the same three steps listed under B below.

Everything after this point that says `-f docker-compose.prod.yml` applies equally
here with `-f docker-compose.ghcr.yml`, run from wherever that file lives (`~/.confer`
if the CLI put it there), except updating: there is nothing to rebuild, so an update is
`npx confer-cli` again, or `docker compose -f docker-compose.ghcr.yml pull && … up -d`.

## B. Build from a clone

Use this to run a modified tree, or to self-host without depending on GHCR:

```bash
git clone https://github.com/hyhmrright/Confer.git
cd Confer
cp .env.example .env
docker compose -f docker-compose.prod.yml up -d --build
```

The first build takes a few minutes. When it finishes:

1. Open **http://localhost**.
2. Click **Register** (the label appears in your own language) and create the
   first account. (Registration is
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

## C. Local development (hot reload)

Run only the infra in Docker and the app code with Bun:

```bash
bun install
docker compose up -d            # infra only — Postgres, Qdrant, MinIO (ports published on localhost)
bun run db:migrate
bun run dev                      # gateway on :3000, client (Vite) on :1420
```

- Web preview: **http://localhost:1420** (Vite proxies `/api` → gateway on :3000).
- Native desktop app: `cd packages/client && bunx tauri dev`.

The dev `docker-compose.yml` publishes each infra port to localhost (5432, 6333, 6334,
9000/9001) so the locally-run gateway can reach them. See
`CONTRIBUTING.md` for the full developer workflow and the isolated test stack.

## Connecting the Claude Code plugin

The `confer-a2a` plugin talks to the gateway over HTTP. **Point it at the right
URL for your setup:**

| Your setup | `CONFER_GATEWAY_URL` |
|------------|----------------------|
| Published images or a clone (options A/B) | `http://localhost` (nginx on port 80; the gateway's 3000 is not published) |
| Local dev (option C) | `http://localhost:3000` (the default) |
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

The default stack listens on plain HTTP, which is fine for its own users and useless
for federation. **HTTPS is not a hardening step here, it is the feature.** An agent's
identity is a `did:web`, and the resolution algorithm is https-only: a peer handed
`did:web:your.domain:agents:you` fetches
`https://your.domain/agents/you/did.json` and nothing else. Serve that over http and
every peer's signature check fails at resolution, before it ever looks at the
signature.

### Serving HTTPS

`docker-compose.tls.yml` is an overlay that fronts the stack with Caddy, which obtains
and renews the certificate itself. Layer it on either base file:

```bash
PUBLIC_HOST=confer.example.com \
  docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml up -d
```

or, from the CLI, `npx confer-cli --domain confer.example.com`.

Three things have to be true, and Caddy will keep retrying until they are (watch
`docker compose … logs caddy`):

- `PUBLIC_HOST` is the **bare domain** — no scheme, no port. Caddy serves 443 and the
  overlay's port mapping is fixed, so `:8443` here would listen where nothing forwards.
- That domain's A/AAAA record already points at this host.
- Ports **80 and 443** are both reachable from the internet. 80 is not optional:
  Let's Encrypt validates over it before anything can be served on 443.

The overlay takes the published port away from the `client` container, so `EXPOSE_PORT`
no longer applies. Certificates live in the `caddydata` volume — losing it means
re-issuing, which is rate-limited.

### Everything else

- Set `PUBLIC_HOST` before you create accounts. Every DID this instance mints derives
  from it, so it is not cosmetic: left at `localhost`, the identities you hand a peer
  resolve to *the peer's own* loopback. Changing it later re-hosts identities still
  carrying the old `localhost` default on the next start (a one-off, logged); any peer
  already holding an old DID has to re-add the contact.
- Change every default secret (`JWT_SECRET`, `ENCRYPTION_KEY`, DB and MinIO passwords).
- Registration is open by default. An admin can close it at any time from the
  **Admin → Config** tab (`registration_open`), or front it with an invite/allowlist.

Bringing your own reverse proxy (Traefik, an existing nginx, a cloud load balancer)
works too — skip the overlay, terminate TLS wherever you like, and forward to the
`client` container's port 80. `PUBLIC_HOST` still has to match the name on the
certificate.

### Free public instance on Oracle Cloud (Always Free)

The cheapest way to run a always-on public test instance is Oracle Cloud's
**Always Free** ARM tier (4 OCPU / 24 GB / 10 TB egress, no time limit). The whole
stack builds and runs on `arm64`.

1. Create a VM: shape **VM.Standard.A1.Flex** (up to 4 OCPU / 24 GB), image
   **Ubuntu 22.04+ (arm64)**. ARM capacity is tight in popular regions — pick a
   large region (Ashburn, London) and retry if you hit "out of capacity".
2. In the Console, open the VCN **security list / NSG** to allow inbound **TCP 80 and
   443**. Open both now even if you start without a domain — the script opens the
   host firewall for both, and this is the half it cannot reach.
3. SSH in and run the bootstrap (installs Docker, opens the host firewall, clones,
   generates secrets, builds and starts the stack):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh | bash
   ```

   With a domain already pointed at the VM, ask for HTTPS at the same time:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh \
     | CONFER_DOMAIN=confer.example.com bash
   ```

   Or clone first and run `bash infra/oracle-bootstrap.sh`. It is idempotent, and
   re-running it with `CONFER_DOMAIN` moves an existing instance onto that domain.
4. Open the URL it prints, register, then grant yourself admin: set
   `ADMIN_USERNAMES=<you>` in `~/Confer/.env` and re-run `up -d gateway` with the same
   `-f` files.

Without `CONFER_DOMAIN` this serves plain HTTP by IP — fine for testing, but the
instance cannot federate, because `did:web` resolves over HTTPS only.

## Upgrading an instance created before 2026-08-29

Confer now runs **PostgreSQL 18** and **Qdrant 1.19**; it previously ran 16 and
1.12. Neither reads storage the older one wrote, so an instance that already
holds data needs one migration before it will start. Nothing is lost, and both
failures are loud: postgres refuses to start and says why, and qdrant panics on
load. A fresh install needs none of this.

`npx confer-cli` checks for the postgres case before it starts anything and
prints the same instructions. To stay on the old versions in the meantime, run
the CLI that shipped them: `npx confer-cli@0.3.3`.

Substitute your own compose file and project name below — `docker-compose.prod.yml`
for a clone, or `-p confer -f ~/.confer/docker-compose.ghcr.yml` for the CLI path.
Volumes are named `<project>_pgdata` and `<project>_qdrantdata`.

**1. Back up, twice.** A logical dump and a byte copy of each volume fail in
different ways, which is the point of taking both.

```bash
docker compose -f docker-compose.prod.yml exec -T postgres pg_dumpall -U confer > pg16-dumpall.sql
for v in pgdata qdrantdata; do
  docker volume create confer_${v}_backup
  docker run --rm -v confer_$v:/from -v confer_${v}_backup:/to alpine:3.24 sh -c 'cd /from && cp -a . /to/'
done
```

**2. Export the vectors** — with their vectors, so nothing has to be embedded
again. Save the output to `qdrant-export.json`:

```bash
docker compose -f docker-compose.prod.yml exec -T gateway bun -e '
const base = "http://qdrant:6333", out = {};
for (const { name } of (await (await fetch(base + "/collections")).json()).result.collections) {
  const info = (await (await fetch(base + "/collections/" + name)).json()).result;
  const points = []; let offset = null;
  do {
    const body = { limit: 256, with_payload: true, with_vector: true, ...(offset ? { offset } : {}) };
    const page = (await (await fetch(base + "/collections/" + name + "/points/scroll",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()).result;
    points.push(...page.points); offset = page.next_page_offset;
  } while (offset);
  out[name] = { config: info.config.params, points };
}
console.log(JSON.stringify(out));' > qdrant-export.json
```

**3. Replace the volumes and start the new versions.** Removing the volumes is
the destructive step; do not run it until step 1 and step 2 have produced files
you have looked at.

```bash
docker compose -f docker-compose.prod.yml down
docker volume rm confer_pgdata confer_qdrantdata
docker compose -f docker-compose.prod.yml up -d postgres qdrant --wait
```

**4. Restore.** The dump recreates the `confer` role and database that the fresh
container already made, so two `already exists` errors are expected; anything
else is not.

```bash
docker compose -f docker-compose.prod.yml exec -T postgres psql -U confer -d postgres < pg16-dumpall.sql
docker compose -f docker-compose.prod.yml up -d
```

Then put the vectors back — collections first, since the app only creates them
lazily:

```bash
docker compose -f docker-compose.prod.yml exec -T gateway bun -e '
const base = "http://qdrant:6333";
const data = JSON.parse(await new Response(Bun.stdin.stream()).text());
for (const [name, { config, points }] of Object.entries(data)) {
  await fetch(base + "/collections/" + name,
    { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(config) });
  if (points.length === 0) continue;
  await fetch(base + "/collections/" + name + "/points?wait=true",
    { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ points }) });
}' < qdrant-export.json
```

**5. Verify against the data, not the logs.** Row counts should match what the
old instance had, and a search should return results:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U confer -d confer -tAc "select count(*) from users;"
docker compose -f docker-compose.prod.yml exec -T gateway bun -e '
const j = await (await fetch("http://qdrant:6333/collections/knowledge_chunks")).json();
console.log(j.result.points_count);'
```

Keep `confer_pgdata_backup` and `confer_qdrantdata_backup` until you have used
the instance for a while — they are the only way back.

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| `postgres` restarts on loop after an upgrade | Its volume was written by PostgreSQL 16. See [Upgrading an instance created before 2026-08-29](#upgrading-an-instance-created-before-2026-08-29). |
| `qdrant` exits 101 with a panic backtrace | Its storage was written by Qdrant 1.12. Same section as above. |
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
