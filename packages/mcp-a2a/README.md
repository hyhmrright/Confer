# @confer/mcp-a2a

Stdio MCP server that lets Codex and Claude Code consult peer A2A agents (your Confer
contacts) as a coding resource — ask a question, get the agent's reply, write
code with it — without using the web UI.

It is a thin authenticated client over the gateway's `/api/v1/consult/*` API.
The signing key never leaves the gateway; this server only carries a bearer
token for one configured Confer user.

## Prerequisites

- The gateway running (e.g. `bun run dev`, default `http://localhost:3000`).
- A registered Confer user whose account already has the peer agents you want
  to consult as **contacts**.

## Configuration (env)

| Var | Default | Required |
|-----|---------|----------|
| `CONFER_GATEWAY_URL` | `http://localhost:3000` | no |
| `CONFER_USERNAME` | — | legacy password login only |
| `CONFER_PASSWORD` | — | legacy password login only |
| `CONFER_API_TOKEN` | OS credential store | optional personal API credential |
| `CONFER_PROJECT_ID` | checkout directory name | optional project identity |
| `CONFER_CONSULT_WAIT` | `25` | no (default seconds `ask_agent` blocks for a reply) |

## Connect from Claude Code

The repo registers this server for Codex and Claude Code. Use browser pairing below, then restart the MCP connection. Legacy password environment variables remain available.

## Tools

| Domain | Tool | Purpose |
|--------|------|---------|
| Discovery | `list_agents` | List consultable contacts with capabilities |
| | `get_agent_capabilities` | Read one peer's AgentFacts capabilities |
| | `find_agents` | Find contacts matching a capability keyword |
| Consult | `ask_agent` | Ask a peer; blocks for the reply when `waitSeconds > 0` |
| | `follow_up` | Follow-up in the same per-peer consult thread |
| | `get_conversation` | Full history of a consult thread |
| Advanced | `ask_multiple` | Ask several peers in parallel (capped at 5) |
| | `check_reply` | Non-blocking poll for a peer's async reply |
| Memory | `sync_project_memory` | Pull/push reviewed local project Markdown with conflict protection |
| Ops | `whoami` | Which Confer user this server acts as |

Replies are **asynchronous** (the peer agent thinks, then answers via an inbound
A2A callback). `ask_agent` blocks up to `waitSeconds`; for slow agents it returns
`pending` and you fetch the answer later with `check_reply`.

## Verification scripts

- `bun run scripts/smoke.ts` — boots the server over stdio and confirms all
  tools register with schemas the strict MCP validator accepts (no gateway
  needed).
- `CONFER_GATEWAY_BASE=http://localhost bun run scripts/live-smoke.ts` —
  registers a throwaway user against a running gateway and exercises the real
  login → whoami → list_agents → consult path.

## Tests

```bash
bun run test        # from this package: unit and MCP stdio tests
```


## Browser pairing and local Markdown

Run `bun run packages/mcp-a2a/src/server.ts --login --gateway http://localhost` from the repository root (or `node <plugin>/dist/server.mjs --login --gateway https://your-instance`). Review the device code, tool name and account in your signed-in browser, then approve. The revocable, 90-day personal API credential is saved in macOS Keychain, Linux Secret Service (`secret-tool`) or Windows DPAPI storage. Restart the MCP server to use it. Legacy username/password environment variables remain supported; `CONFER_API_TOKEN` can also supply a personal API credential. Never commit credentials.

Optional shared `.confer/project.json`: `{"gatewayUrl":"http://localhost","projectId":"my-project"}`. Environment variables take priority. `sync_project_memory` pulls or pushes `.confer/peers/<peerId>/facts.md` and `decisions.md`, with identity, local-edit and server-version checks. Start the server in the project root. Conflicts preserve existing files and require manual reconciliation; there is no force overwrite.

See [Agent workflows](../../docs/10-agent-workflows.md) for the six user flows and boundaries. The SDK stdio smoke test checks the real handshake, strict tool schemas, API credential use and Markdown files.
