# CLAUDE.md

## Project: Confer

A2A protocol platform for AI Agents to communicate on behalf of their owners. See `docs/01-product.md` for full product context.

## Docs index

| Topic | File |
|---|---|
| Product vision | `docs/01-product.md` |
| Architecture | `docs/02-architecture.md` |
| A2A protocol | `docs/03-protocol.md` |
| Data model | `docs/04-data-model.md` |
| API surface | `docs/05-api.md` |
| MCP plugin design | `docs/06-claude-code-plugin.md` |
| Project memory format | `docs/07-project-memory.md` |
| MVP backlog | `docs/08-mvp-backlog.md` |

Default to **MVP scope (v0.1)** per `docs/08-mvp-backlog.md`.

## Tech stack

TypeScript everywhere. Bun runtime + Hono (server), Tauri 2.0 + React 18 + Zustand (client). PostgreSQL 16, Redis, NATS, Qdrant, MinIO. Bun workspaces monorepo. Identity: DID:web + RFC 9421 HTTP signatures. MCP: `@modelcontextprotocol/sdk`.

## Coding conventions

- Sentence case in headings/labels
- 2-space indent, named exports, async/await, no `any` without comment
- Zod schemas for all external inputs; ULID for entity IDs
- `Result<T, E>` for expected failures; throw only for programmer errors
- One responsibility per file
- Files: `kebab-case.ts`, `kebab-case.test.ts`, `PascalCase.tsx`, migrations `NNNN_description.sql`

## Contracts (do not break)

1. A2A endpoints (`/a2a/v1/*`) require HTTP signature verification — never disable
2. DID documents must be valid W3C DID v1.0 — use the `did` library
3. AgentFacts must validate against NANDA schema
4. Migration files are immutable once merged
5. `.claude/peers/*` must stay human-readable Markdown

## Forbidden

- Plaintext passwords/API keys (Argon2id / AES-256-GCM)
- Sending LLM API keys to client
- Disabling signature verification
- Inline SQL (use query builder)
- Auto-accepting L3 permissions
- Logging full A2A request bodies (PII)

## When generating code

- Read `docs/` for design intent before significant new logic
- Read related existing code for patterns to follow
- Use existing libraries for crypto/DID/HTTP signatures/MCP
- LLM calls go through `LLMProvider` abstraction
- Adding API endpoints → also update `docs/05-api.md`
- Adding A2A features → also update `docs/03-protocol.md`
- Adding MCP tools → also update `docs/06-claude-code-plugin.md`
- Outside MVP scope → check `docs/08-mvp-backlog.md`, ask before expanding

## Pitfalls

- MCP SDK tool schema validator is strict — test with real Claude Code, not just unit tests
- `Bun.serve` WebSocket API differs from Node `ws` — don't copy Node examples
- HTTP signatures cover specific headers — adding headers invalidates unless in signing set
- DID document caching: respect TTL/ETag or auth breaks
- Tauri 2.0 iOS: defer mobile debugging until v0.3
