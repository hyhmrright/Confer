# Confer — System architecture

## High-level architecture

```
┌────────────────────────────────────────────────────────────┐
│  Clients (Tauri 2.0)                                       │
│  iOS · Android · Windows · macOS · Linux                   │
└──────────────────────────┬─────────────────────────────────┘
                           │ WSS / HTTPS / SSE
                           ▼
┌────────────────────────────────────────────────────────────┐
│  Edge API Gateway  (Bun + Hono)                            │
│  Auth · Rate limit · Routing · WS fan-out                  │
└─────┬─────────────┬─────────────────┬────────────────┬─────┘
      │             │                 │                │
      ▼             ▼                 ▼                ▼
 ┌────────┐  ┌─────────────┐  ┌────────────┐  ┌──────────────┐
 │ Agent  │  │Conversation │  │ Identity & │  │ MCP / Tools  │
 │Runtime │  │     Hub     │  │A2A Gateway │  │  Connector   │
 └───┬────┘  └──────┬──────┘  └─────┬──────┘  └──────┬───────┘
     │              │               │                │
     ▼              ▼               ▼                ▼
┌──────────────────────────────────────────────────────────────┐
│  Data layer: PostgreSQL · Redis · NATS · Vector (Qdrant)·S3 │
└──────────────────────────────────────────────────────────────┘
       │                              │
       ▼                              ▼
 LLM providers              Other instances' Agents
 (Claude / GPT /            (federation via A2A
  DeepSeek / Qwen)           over HTTPS)
```

## Design principles

- **Stateless edge, stateful core**: the gateway is stateless and horizontally scalable; the Agent runtime is sharded by user, with state held in PG/Redis
- **Federation-ready from day 1**: with DID:web identity + AgentFacts, even a single instance runs on the federation protocol, so future federation incurs zero migration cost
- **BYO LLM key**: the platform does not bear LLM costs; users bring their own API key
- **Protocol-first**: core interactions use open protocols (A2A, MCP, DID:web, NANDA AgentFacts) rather than being locked into a proprietary protocol
- **Bun + TypeScript full stack**: the backend is Bun + Hono and the client is Tauri + React, so types can be shared

## Service boundaries

### 1. Edge API Gateway

See `docs/05-api.md`.

- **Responsibilities**: TLS termination, dual user/A2A authentication, four-dimensional rate limiting, HTTP/WS/SSE routing, multi-device fan-out
- **Tech stack**: Bun + Hono
- **Key dependencies**: JWKS (user token verification), DID document cache, NATS (fan-out)
- **Does not do**: business logic, persisting business data, calling the LLM

### 2. Agent Runtime

Each user maps to one resident Agent instance.

- **Responsibilities**:
  - Maintain the state of the user's Agent (model selection, tools, policy, memory)
  - The LLM call loop (multi-provider abstraction)
  - MCP client, connecting to the tool servers the user has installed
  - Outbound A2A calls (going to negotiate with other people's Agents)
  - The policy engine (deciding what may be disclosed to the other party)
- **Lifecycle**: woken on demand. When a message comes in or an A2A request arrives, it loads state from PG, runs one round, and writes back.
- **Key dependencies**: LLM providers, MCP servers, Identity service

### 3. Conversation Hub

- **Responsibilities**: message storage, subscription, push
- **Supported conversation types**:
  - User ↔ their own Agent
  - User ↔ the other party's Agent (relayed through their own Agent)
  - User ↔ user (ordinary IM)
  - Group chat (a mix of users + Agents)
- **Key dependencies**: NATS Streams (persistence + fan-out), PG (message history), Redis (presence, unread counts)

### 4. Identity & A2A Gateway

- **Responsibilities**:
  - Manage the user's DID:web document
  - Expose and cache AgentFacts
  - Handle inbound A2A requests (verifying the HTTP signature, capability token)
  - Forward outbound A2A requests
  - Rate limiting and anti-spam for federation peers
- **Key dependencies**: PG (DID/peer cache), Redis (counter-based rate limiting)

For the detailed protocol design, see `docs/03-protocol.md`.

### 5. MCP / Tools Connector

- **Responsibilities**:
  - Connection management for the MCP tool servers the user has installed
  - The Agent runtime calls tools through here
  - Standardized wrapping of tool-call results
- **Key dependencies**: `@modelcontextprotocol/sdk`

## Data layer

| Component | Purpose |
|---|---|
| PostgreSQL | Users, Agents, conversations, messages, permissions, peer relationships (primary store) |
| Redis | Sessions, presence, rate-limit counters, hot-data cache |
| NATS Streams | Message fan-out (user.{uid}.events) + Agent runtime task queue |
| Qdrant or pgvector | Agent long-term memory RAG, user knowledge-base index |
| S3-compatible (MinIO) | File attachments, DID document backups, conversation archives |

## Client architecture

- **Foundation**: Tauri 2.0 (Rust core + WebView rendering)
- **Frontend**: React 18 + TypeScript + Tailwind CSS
- **State management**: Zustand or Jotai (lightweight)
- **Routing**: TanStack Router
- **Networking**: native fetch + native WebSocket + EventSource (SSE)
- **Local storage**: SQLite + key-value store provided by Tauri (caching conversations, offline message drafts)

### Cross-platform coverage

| Platform | Via |
|---|---|
| iOS | Tauri 2.0 iOS support |
| Android | Tauri 2.0 Android support |
| Windows | Tauri 2.0 |
| macOS | Tauri 2.0 |
| Linux | Tauri 2.0 |

A single codebase, with no native fallback.

### Claude Code plugin

See `docs/06-claude-code-plugin.md`.

- A standalone MCP server process, implemented with Node.js / Bun
- Users install it via `claude mcp add confer <command>`
- Bound to the user's Confer account via OAuth / token

## Deployment architecture

### Single instance (individuals / small teams)

```
docker-compose.yml:
  - gateway       (Bun 服务)
  - agent-runtime (Bun 服务)
  - conversation  (Bun 服务)
  - identity      (Bun 服务)
  - postgres
  - redis
  - nats
  - qdrant
  - minio
  - caddy / traefik  (反向代理 + TLS)
```

Deployment: just run `docker compose up -d` and it works.

### Enterprise instance

- A standalone deployment brought up with the same Docker Compose as above
- Uses its own domain (`acme.com`)
- Exposes `https://acme.com/.well-known/did.json` and `https://acme.com/.well-known/agent.json`
- Internal users log in via SSO

### Cloud (Confer's own cloud)

- Multi-tenant Kubernetes
- Each user/enterprise has its own namespace or schema
- A shared LLM provider abstraction layer (but still using the user's own key)
- Global multi-region deployment, connecting through the nearest region

## Federation (cross-instance)

Any Confer instance (self-hosted or cloud) can interoperate with other instances via the A2A protocol.

```
[acme.com]              [vendor-x.com]            [confer.cloud]
 Agent A    <─── A2A ───> Agent B    <─── A2A ───> Agent C
```

Identity and discovery:

- Each instance exposes its DID document at `/.well-known/did.json`
- Each Agent exposes its AgentFacts at `/.well-known/agent.json`
- Cross-instance search: fan-out to known instances + public registries

## Observability

- **Tracing**: OpenTelemetry, with trace_id injected at the gateway and propagated across all services
- **Logging**: JSON-structured, collected by Vector / Loki
- **Metrics**: Prometheus, key metrics:
  - `gateway_active_ws_connections{user_id}`
  - `agent_runtime_llm_tokens_total{provider,role}`
  - `a2a_inbound_requests_total{peer_domain,status}`
  - `mcp_tool_calls_total{tool,result}`

## Security boundaries

- User ↔ gateway: JWT + JWKS verification
- A2A peer ↔ gateway: HTTP Message Signatures (RFC 9421) + DID:web public key
- Internal RPC between services: mTLS or shared secret (within the Docker network)
- LLM provider calls: API keys stored encrypted (AES-256, key held in Vault / KMS)
- User file storage: S3 server-side encryption

## Key technical decisions

| Decision | Choice | Alternatives | Rationale |
|---|---|---|---|
| Backend language | Bun + TypeScript | Go | The MCP/A2A SDKs are TS-first; full-stack type sharing |
| Web framework | Hono | Elysia, Fastify | Lightweight, fast, stable ecosystem |
| Client | Tauri 2.0 | Flutter, Electron | One codebase across 5 platforms, Rust safety, small footprint |
| Primary store | PostgreSQL 16 | MySQL | Good JSON support, strong extensibility, pgvector optional |
| Message bus | NATS | Kafka, Redis Pub/Sub | Lightweight, persistent, precise subscriptions |
| Vector store | Qdrant | Pinecone, pgvector | Mature self-hosting, stable performance (written in Rust) |
| Identity | DID:web | DID:key, OAuth-only | Compatible with web infrastructure, recommended by NANDA |
| Protocol | A2A + MCP + AgentFacts | Proprietary protocol | Betting on the open-protocol ecosystem |
