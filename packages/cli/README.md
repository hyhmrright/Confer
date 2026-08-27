# confer-cli

Runs a self-hosted [Confer](https://github.com/hyhmrright/Confer) instance with one
command.

```bash
npx confer-cli
```

It checks that Docker is running, generates the instance's secrets, pulls the published
images, applies migrations and waits until the web UI actually answers — then prints the
URL. Nothing is built and nothing is cloned.

Open **http://localhost**, register the first account, and add an LLM API key in
**Settings**.

```bash
npx confer-cli down   # stop it, keeping all data
npx confer-cli logs   # follow the gateway log
```

## Options

| Flag | Default | |
|---|---|---|
| `--port <n>` | `80` | host port for the web UI |
| `--dir <path>` | `~/.confer` | where the compose file and secrets are kept |
| `--version <tag>` | `latest` | image tag to run |
| `--project <name>` | `confer` | docker compose project name |

## What it writes

Everything lives in `--dir`, and nothing else on the machine is touched:

- `docker-compose.ghcr.yml` — the stack (Postgres, Qdrant, MinIO, gateway, web client).
  Rewritten on every `up`, so an upgrade picks up topology changes; edits to this copy
  do not survive.
- `.env` — `JWT_SECRET`, `ENCRYPTION_KEY` and the database and object-store passwords,
  generated with `crypto.randomBytes` on first run and written `0600`. Written once and
  never touched again.

**Keep `.env`.** `ENCRYPTION_KEY` decrypts every LLM API key stored in the instance, and
losing it means losing them. It is generated once and then reused, so a later `up` keeps
working against the same data.

If a docker compose project named `confer` already exists on the machine and this CLI did
not create it, the CLI stops rather than adopt it — compose volumes are keyed by project
name, so starting would point these images at that stack's database. Pass `--project` to
run a second instance alongside it.

## Requirements

Docker with Compose v2, and Node 18 or newer.

Apache-2.0 · [source](https://github.com/hyhmrright/Confer/tree/main/packages/cli)
