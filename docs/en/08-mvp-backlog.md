# Confer — MVP roadmap and backlog

Sliced by milestone, where each milestone is a deliverable, demoable version.

## v0.1 — Core proof of concept (4-6 weeks)

**Goal**: Run the full "user ↔ own Agent ↔ peer Agent" chain end to end on a single machine.

**Scope (must-do)**:

- [x] Backend: gateway + agent runtime + conversation + identity (4 services, either in a single process or standalone)
- [x] PostgreSQL schema (see 04-data-model.md), managed via a migration tool
- [x] User registration / login (password login alone is enough, no OAuth/passkey)
- [x] DID:web document generation and exposure (`/.well-known/did.json`)
- [x] AgentFacts document generation and exposure
- [ ] A2A protocol inbound and outbound (HTTP signature verification + capability token verification)
- [x] Agent runtime: LLM call loop (support only the two providers Claude and DeepSeek at first)
- [x] Simple policy engine: peer whitelist + allow-all / deny-all
- [x] Client: a single Tauri app, desktop three-platform first (Linux / macOS / Windows, mobile later)
- [x] The client can: log in / add contacts (add by DID) / 1-on-1 conversation / see citations
- [x] WebSocket real-time message push (single instance is enough, no NATS fan-out)
- [x] SSE streaming LLM output
- [x] Docker Compose one-command local dev environment

**Out of scope**:

- Group chat, multi-device fan-out, mobile, multilingual UI, CDN, external OAuth, complex policies
- The Claude Code plugin is not included in this one for now

**Acceptance**:

Two developers each spin up a Confer instance locally, add each other as friends, converse with each other, and can see citations.

---

## v0.2 — Claude Code plugin MVP (3-4 weeks)

**Goal**: Be able to consult peer Agents from within Claude Code, with answers persisted into the project.

**Scope**:

- [x] MCP server implementation, providing the 4 tools `ask_peer`, `list_peers`, `read_project_memory`, `write_project_memory`
- [ ] OAuth-style binding of a Confer account to a Claude Code instance
- [ ] `.claude/confer.toml` config file parsing
- [ ] Reading and writing the `.claude/peers/{slug}/` directory (facts.md, decisions.md, conversations/, meta.json)
- [ ] Automatic fact extraction: after ask_peer, extract structured facts from the answer and write them into facts.md
- [ ] `confer` CLI tool (add peer, list peers, ask, sync)
- [ ] A demo peer Agent (mock-vendor.confer.dev) for developers to test with

**Acceptance**:

A developer installs `claude mcp add confer`, and after configuration, can ask the mock vendor a question from within Claude Code; the answer comes with citations, is written to `.claude/peers/mock-vendor/facts.md`, committed to git, and is auto-loaded in the next session.

---

## v0.3 — Group chat and enterprise instances (4-5 weeks)

**Goal**: Support group chat (mixing users + Agents), and be able to deploy an "enterprise instance" on a single machine.

**Scope**:

- [ ] Group chat data model and UI
- [ ] Group member management (add / remove people and Agents)
- [ ] Multiple @Agents answering simultaneously (collapsed display, an "adopt" mechanism)
- [ ] Enterprise instance: with a custom domain, SSO login (OIDC is enough)
- [x] Contact discovery: lookup by domain (enter acme.com to automatically find the Agents that domain publishes)
- [ ] Multi-device fan-out (introduce NATS)
- [ ] Mobile (iOS, Android)

**Acceptance**:

A small team of 5 + 2 Agents run a project discussion together in one group, with a smooth experience. A company can self-host a Confer instance, expose a public Agent externally, and be found by other instances.

---

## v0.4 — Multilingual and offline auto-answer (3 weeks)

**Goal**: Make the product useful for internationalization scenarios and semi-asynchronous communication.

**Scope**:

- [x] UI i18n (Chinese, English to start, with Japanese/German/French reserved)
- [ ] Cross-language conversation between Agents (translation done inside the target Agent, citations preserve the original text)
- [ ] Add a `primary_language` field to AgentFacts
- [ ] Offline auto-answer: standing policy settings UI + pending inbox + push notification
- [x] Pre-flight design review tool added to the MCP server
- [x] Post-flight code review tool added to the MCP server

**Acceptance**:

A Chinese developer asks a German vendor's Agent (German docs) a question in Chinese, and gets a Chinese answer + a citation to the original German text. After setting a standing policy, while offline the Agent can correctly handle requests that match the rules and suspend the uncertain ones.

---

## v1.0 — Production ready (4-6 weeks)

**Goal**: Be usable in a production environment, with commercial support.

**Scope**:

- [ ] Full observability (OTel tracing, Prometheus metrics, Loki logs)
- [ ] Backup and recovery (PG physical backup + S3 incremental)
- [x] Security audit (audit log for critical operations)
- [ ] Rate-limiting refinement (all 4 dimensions done)
- [ ] LLM usage dashboard (per-Agent monthly cost)
- [ ] Full BYO LLM key UX (encrypted storage, rotation, quotas)
- [x] Documentation site (user manual, self-hosting deployment guide, API reference)
- [ ] Public Confer Cloud instance goes live (`cloud.confer.ai`)

**Acceptance**:

At least 100 registered users, 10 independent peer Agent deployments, and a single instance running stably for over 30 days.

---

## v1.5+ — Growth and ecosystem (ongoing)

**Scope**:

- [ ] Public Agent directory (integrate with the NANDA Index)
- [ ] Trust graph and reputation system
- [ ] Personal consumer version (lighter-weight UI)
- [ ] Reputation-based anti-spam
- [ ] Webhooks (third-party system integration)
- [ ] Multiple Agents per user (one user with several specialized Agents)
- [ ] Browser extension (invoke Agents on web pages)

---

## Task granularity (for use by Claude Code)

Each milestone is broken down into 50-200 small tasks. Each task:

1. Has clear inputs and outputs
2. Has testable acceptance criteria
3. Is no more than 1 developer-day of work

For example, some sample tasks for v0.1:

### Backend skeleton

- [x] Create the monorepo (pnpm workspaces or Bun workspaces)
- [x] `packages/shared`: shared type definitions (using zod or valibot)
- [x] `packages/gateway`: Bun + Hono application skeleton
- [x] `packages/agent-runtime`: Agent state machine skeleton
- [x] ~~`packages/conversation`: message storage / push service~~ — folded into the gateway (`ws/handler.ts` + `routes/conversations.ts`); the standalone package had zero consumers and was removed 2026-08-07
- [x] `packages/identity`: DID + AgentFacts + A2A verification
- [x] PostgreSQL migration tool (drizzle-kit or prisma)
- [x] Create the migration files for all data tables

### Database layer

- [x] User CRUD (registration, login, view personal info)
- [x] Agent CRUD (create your own Agent, modify config)
- [x] PeerAgent CRUD (add, query, delete contacts)
- [x] Conversation CRUD + Participant management
- [x] Message CRUD + pagination
- [x] Writing to and querying the Permission table

### Identity and protocol

- [x] DID document generation (create an ed25519 keypair per user)
- [x] `/.well-known/did.json` endpoint
- [x] AgentFacts generation and endpoint
- [x] HTTP signature signer (outbound)
- [x] HTTP signature verifier (inbound)
- [ ] Capability token issuance and verification
- [x] DID document fetcher + cache

### LLM abstraction

- [x] LLM provider interface (chat, stream, tools)
- [x] Claude provider implementation
- [x] DeepSeek provider implementation
- [x] API key encrypted storage (Vault / env)
- [x] Apply per-Agent model config

### Agent runtime

- [x] Agent state machine: load → process → save loop
- [x] LLM call loop + tool calling
- [x] Simple policy engine (whitelist + allow/deny)
- [x] A2A outbound calls (Agent sends a message to someone else)
- [x] A2A inbound handling (receive a message from someone else's Agent)

### Gateway and API

- [x] JWT issuance / verification middleware
- [x] All `/api/v1/auth/*` endpoints
- [x] All `/api/v1/conversations/*` endpoints
- [x] WebSocket handler (subscribe, send messages)
- [x] SSE handler (LLM streaming output)
- [x] A2A inbound endpoints + signature verification middleware
- [x] Rate-limiting middleware (simple version first: fixed window)

### Client

- [x] Tauri 2.0 project initialization
- [x] Login / registration pages
- [x] Main interface: contact list on the left + conversation on the right
- [x] Add-contact dialog (by DID or domain)
- [x] Conversation message list (streaming rendering)
- [x] Citation capsule rendering
- [x] Permission request card rendering
- [x] WebSocket connection management
- [ ] Local SQLite cache of the most recent 100 messages

### Demo content

- [ ] Deploy the mock-vendor Agent (for demo purposes)
- [ ] X100 mock manual (a few pages of PDF as RAG data)
- [ ] Demo video / docs: the end-to-end flow from adding a friend to getting an answer

---

## Risks and early decisions needed

| Risk | Mitigation |
|---|---|
| The MCP SDK is still evolving, the API may have breaking changes | Pin to a stable version, monitor the changelog, build an adaptation layer |
| Both the A2A protocol (Google) and the NANDA standard are still evolving | Start with the simplest subset, reserve a protocol adaptation layer |
| Tauri 2.0 iOS / Android is relatively new, may hit pitfalls | Do only the desktop three platforms in the MVP phase, do mobile in v0.3 |
| LLM cost spiraling out of control | Default quota + explicit BYO key + build the usage dashboard early |
| The SDKs for domestic LLM provider integration (DeepSeek/Qwen) are unstable | Use the OpenAI-compatible interface (which these providers all support) as a unified integration point |

## Implementation notes for Claude Code

1. **Do unit tests before integration**: each service must be able to run tests on its own, without depending on other services being up
2. **Database migrations go through the migration tool**, do not hand-write SQL
3. **Share types via the `@confer/shared` package**, used by both frontend and backend
4. **Every PR must come with doc changes** (if the protocol or API changed)
5. **Prefer off-the-shelf libraries for the A2A protocol implementation** (such as the `http-message-signatures` npm package), do not reinvent the wheel
6. **Prefer `did-resolver` + `did-jwt`** and other W3C tools for the DID:web implementation
7. **Prefer the official SDK for the MCP server** (`@modelcontextprotocol/sdk`)
8. **Write the commit subject as a sentence saying what the change does**, not
   a conventional prefix. Note that `.github/scripts/gen-release-notes.sh`
   recognises only `feat:` / `fix:`-style prefixes, so release notes have to be
   written by hand — it will not generate them from prose subjects
