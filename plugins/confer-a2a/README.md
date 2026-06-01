# confer-a2a (Claude Code plugin)

Consult peer A2A agents — the contacts in your [Confer](https://github.com/hyhmrright/Confer)
account — directly from Claude Code. Ask a peer agent a question, get its reply,
and write code with it, without opening the web UI.

This plugin bundles a self-contained MCP server (`dist/server.mjs`, no monorepo
or `bun` required — plain `node` runs it). The Confer signing key never leaves
your gateway; the server only carries a bearer token for one configured user.

## Install

```
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer
```

## Configure

Set these in your shell before launching Claude Code (the plugin reads them from
the environment — credentials are never written into the repo or plugin):

| Var | Default | Required |
|-----|---------|----------|
| `CONFER_USERNAME` | — | **yes** |
| `CONFER_PASSWORD` | — | **yes** |
| `CONFER_GATEWAY_URL` | `http://localhost:3000` | no |
| `CONFER_CONSULT_WAIT` | `25` | no (seconds `ask_agent` blocks for a reply) |

```bash
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
```

## Prerequisites

- A running Confer gateway (`CONFER_GATEWAY_URL`).
- The peer agents you want to consult must already be **contacts** of your
  Confer account (consulting a non-contact is rejected — adding a contact is the
  consent gate).
- `node` on your PATH (the bundle targets Node; no `bun` needed to run it).

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

## Rebuilding the bundle

`dist/server.mjs` is generated from `packages/mcp-a2a`. After changing that
package, regenerate it from the repo root:

```bash
bun run --filter @confer/mcp-a2a build:plugin
```
