# Codex migration

This repository supports Codex alongside the retained Claude Code configuration.

## Project instructions and skills

`AGENTS.md` is Codex's project instruction entry point. `.codex/config.toml` raises
`project_doc_max_bytes` to 96 KiB because this file exceeds the default 32 KiB.
Open a new chat after configuration changes to pick up the complete instructions.

Codex discovers the eight skills in `.agents/skills/`. Invoke them with
`$deploy`, `$create-migration`, `$rag-debug`, `$sync-env`,
`$reset-user-password`, `$a2a-contract-reviewer`, `$migration-reviewer`, or
`$rag-pipeline-reviewer`. The review checklists run directly in the current chat;
they are not registered subagents. The three previously manual-only skills
(rag-debug, sync-env, reset-user-password) retain that policy in
`agents/openai.yaml`.

The original `.claude/` directory, `CLAUDE.md`, and `.mcp.json` are retained for
compatibility. Codex uses the new locations. When project contracts change,
keep both instruction entry points consistent.

## Checks previously supplied by hooks

Claude's hook payloads and tool names cannot simply be copied into Codex.
No Claude hooks are registered by this migration. `AGENTS.md` explicitly carries
the migration-file, live-env, test-command, formatting and typecheck rules.
These are agent instructions, not hard tool interception. Do not assume edits
have already been checked. The shell-viewer ban addressed Claude's tracked-read
requirement and is intentionally not carried over.

Only assistant configuration and Markdown changed in this migration; there is
no running application change to redeploy.

## Confer MCP

`.codex/config.toml` configures the existing stdio server without storing secrets.
Start Codex at the repository root, and ensure its launching environment has
`CONFER_USERNAME` and `CONFER_PASSWORD`. Set them privately in your local launcher
or shell; do not paste passwords into chat, tracked files, or command arguments.
Desktop launches must inherit these variables too; setting them in an unrelated
terminal does not update an already running desktop process.

Optional forwarded variables are `CONFER_GATEWAY_URL`, `CONFER_CONSULT_WAIT`,
and `CONFER_PROJECT_ID`. Without overrides, the existing server uses
`http://localhost:3000`, a 25-second consult wait, and the working directory name
as project scope. Confirm the gateway URL matches the running instance; a stack
accessible through the reverse proxy may need `http://localhost` instead.

Run `codex mcp get confer-a2a` from the root to inspect the effective configuration.
Project configuration must be trusted for Codex to load it. Restart the app or
start a new session after supplying the environment and configuration. Confirm
the server appears, then call `list_agents` to exercise gateway authentication.
`whoami` only returns local configuration and does not prove login works.
Initialization and tool discovery can be checked without real credentials;
this does not validate account login, peer connectivity, or a consult round trip.

## References

- [Project instructions](https://developers.openai.com/codex/guides/agents-md)
- [Skills and repository discovery](https://developers.openai.com/codex/skills)
- [MCP configuration](https://developers.openai.com/codex/mcp)
