# Confer — MVP roadmap and backlog

Sliced by milestone, where each milestone is a deliverable, demoable version.

## v0.1 — Core proof of concept (4-6 weeks)

**Goal**: Run the full "user ↔ own Agent ↔ peer Agent" chain end to end on a single machine.

**Scope (must-do)**:

- [ ] Backend: gateway + agent runtime + conversation + identity (4 services, either in a single process or standalone)
- [ ] PostgreSQL schema (see 04-data-model.md), managed via a migration tool
- [ ] User registration / login (password login alone is enough, no OAuth/passkey)
- [ ] DID:web document generation and exposure (`/.well-known/did.json`)
- [ ] AgentFacts document generation and exposure
- [ ] A2A protocol inbound and outbound (HTTP signature verification + capability token verification)
- [ ] Agent runtime: LLM call loop (support only the two providers Claude and DeepSeek at first)
- [ ] Simple policy engine: peer whitelist + allow-all / deny-all
- [ ] Client: a single Tauri app, desktop three-platform first (Linux / macOS / Windows, mobile later)
- [ ] The client can: log in / add contacts (add by DID) / 1-on-1 conversation / see citations
- [ ] WebSocket real-time message push (single instance is enough, no NATS fan-out)
- [ ] SSE streaming LLM output
- [ ] Docker Compose one-command local dev environment

**Out of scope**:

- Group chat, multi-device fan-out, mobile, multilingual UI, CDN, external OAuth, complex policies
- The Claude Code plugin is not included in this one for now

**Acceptance**:

Two developers each spin up a Confer instance locally, add each other as friends, converse with each other, and can see citations.

---

## v0.2 — Claude Code plugin MVP (3-4 weeks)

**Goal**: Be able to consult peer Agents from within Claude Code, with answers persisted into the project.

**Scope**:

- [ ] MCP server implementation, providing the 4 tools `ask_peer`, `list_peers`, `read_project_memory`, `write_project_memory`
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
- [ ] Contact discovery: lookup by domain (enter acme.com to automatically find the Agents that domain publishes)
- [ ] Multi-device fan-out (introduce NATS)
- [ ] Mobile (iOS, Android)

**Acceptance**:

A small team of 5 + 2 Agents run a project discussion together in one group, with a smooth experience. A company can self-host a Confer instance, expose a public Agent externally, and be found by other instances.

---

## v0.4 — Multilingual and offline auto-answer (3 weeks)

**Goal**: Make the product useful for internationalization scenarios and semi-asynchronous communication.

**Scope**:

- [ ] UI i18n (Chinese, English to start, with Japanese/German/French reserved)
- [ ] Cross-language conversation between Agents (translation done inside the target Agent, citations preserve the original text)
- [ ] Add a `primary_language` field to AgentFacts
- [ ] Offline auto-answer: standing policy settings UI + pending inbox + push notification
- [ ] Pre-flight design review tool added to the MCP server
- [ ] Post-flight code review tool added to the MCP server

**Acceptance**:

A Chinese developer asks a German vendor's Agent (German docs) a question in Chinese, and gets a Chinese answer + a citation to the original German text. After setting a standing policy, while offline the Agent can correctly handle requests that match the rules and suspend the uncertain ones.

---

## v1.0 — Production ready (4-6 weeks)

**Goal**: Be usable in a production environment, with commercial support.

**Scope**:

- [ ] Full observability (OTel tracing, Prometheus metrics, Loki logs)
- [ ] Backup and recovery (PG physical backup + S3 incremental)
- [ ] Security audit (audit log for critical operations)
- [ ] Rate-limiting refinement (all 4 dimensions done)
- [ ] LLM usage dashboard (per-Agent monthly cost)
- [ ] Full BYO LLM key UX (encrypted storage, rotation, quotas)
- [ ] Documentation site (user manual, self-hosting deployment guide, API reference)
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

- [ ] Create the monorepo (pnpm workspaces or Bun workspaces)
- [ ] `packages/shared`: shared type definitions (using zod or valibot)
- [ ] `packages/gateway`: Bun + Hono application skeleton
- [ ] `packages/agent-runtime`: Agent state machine skeleton
- [ ] `packages/conversation`: message storage / push service
- [ ] `packages/identity`: DID + AgentFacts + A2A verification
- [ ] PostgreSQL migration tool (drizzle-kit or prisma)
- [ ] Create the migration files for all data tables

### Database layer

- [ ] User CRUD (registration, login, view personal info)
- [ ] Agent CRUD (create your own Agent, modify config)
- [ ] PeerAgent CRUD (add, query, delete contacts)
- [ ] Conversation CRUD + Participant management
- [ ] Message CRUD + pagination
- [ ] Writing to and querying the Permission table

### Identity and protocol

- [ ] DID document generation (create an ed25519 keypair per user)
- [ ] `/.well-known/did.json` endpoint
- [ ] AgentFacts generation and endpoint
- [ ] HTTP signature signer (outbound)
- [ ] HTTP signature verifier (inbound)
- [ ] Capability token issuance and verification
- [ ] DID document fetcher + cache

### LLM abstraction

- [ ] LLM provider interface (chat, stream, tools)
- [ ] Claude provider implementation
- [ ] DeepSeek provider implementation
- [ ] API key encrypted storage (Vault / env)
- [ ] Apply per-Agent model config

### Agent runtime

- [ ] Agent state machine: load → process → save loop
- [ ] LLM call loop + tool calling
- [ ] Simple policy engine (whitelist + allow/deny)
- [ ] A2A outbound calls (Agent sends a message to someone else)
- [ ] A2A inbound handling (receive a message from someone else's Agent)

### Gateway and API

- [ ] JWT issuance / verification middleware
- [ ] All `/api/v1/auth/*` endpoints
- [ ] All `/api/v1/conversations/*` endpoints
- [ ] WebSocket handler (subscribe, send messages)
- [ ] SSE handler (LLM streaming output)
- [ ] A2A inbound endpoints + signature verification middleware
- [ ] Rate-limiting middleware (simple version first: fixed window)

### Client

- [ ] Tauri 2.0 project initialization
- [ ] Login / registration pages
- [ ] Main interface: contact list on the left + conversation on the right
- [ ] Add-contact dialog (by DID or domain)
- [ ] Conversation message list (streaming rendering)
- [ ] Citation capsule rendering
- [ ] Permission request card rendering
- [ ] WebSocket connection management
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
8. **Use conventional commits for commit messages** (feat:, fix:, docs:, etc.)
