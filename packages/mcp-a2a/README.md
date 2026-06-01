# @confer/mcp-a2a

Stdio MCP server that lets Claude Code consult peer A2A agents (your Confer
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
| `CONFER_USERNAME` | — | **yes** |
| `CONFER_PASSWORD` | — | **yes** |
| `CONFER_CONSULT_WAIT` | `25` | no (default seconds `ask_agent` blocks for a reply) |

## Connect from Claude Code

The repo ships a `.mcp.json` registering this server as `confer-a2a`. Export
`CONFER_USERNAME` / `CONFER_PASSWORD` in your shell, then open Claude Code in
the repo — the `confer-a2a` tools load automatically.

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
| Ops | `whoami` | Which Confer user this server acts as |

Replies are **asynchronous** (the peer agent thinks, then answers via an inbound
A2A callback). `ask_agent` blocks up to `waitSeconds`; for slow agents it returns
`pending` and you fetch the answer later with `check_reply`.

## Verification scripts

- `bun run scripts/smoke.ts` — boots the server over stdio and confirms all 9
  tools register with schemas the strict MCP validator accepts (no gateway
  needed).
- `CONFER_GATEWAY_BASE=http://localhost bun run scripts/live-smoke.ts` —
  registers a throwaway user against a running gateway and exercises the real
  login → whoami → list_agents → consult path.

## Tests

```bash
bun test            # unit tests (mock gateway)
```
