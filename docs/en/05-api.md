# Confer — API specification

Defines every API between client and server, and between server and A2A peers.

## General conventions

- Base URL: `https://{instance}/api`
- Encoding: JSON, UTF-8
- Timestamps: ISO 8601, UTC (`2024-11-15T14:30:00Z`)
- Identifiers: ULID (`01HXKQ7Z2N3M4P5R6T7Y8Z9A0B`)
- Error format:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Human-readable message",
    "details": { /* optional */ }
  }
}
```

## Authentication

- User client: `Authorization: Bearer <jwt_access_token>`
- Access token TTL: 15 minutes; refresh token TTL: 90 days
- The two tokens are told apart by the `typ` claim (`access` / `refresh`) and are **not interchangeable**: the `Authorization` header accepts only `access`, and `POST /auth/refresh` only `refresh`. They used to differ in nothing but `exp`, which made the refresh token a 90-day pass on every authenticated endpoint and the access token's 15 minutes meaningless
- The refresh token rotates on every use and is checked against `sessions.refresh_token_hash`; a mismatch is treated as a replay and invalidates the whole session. `sessions.expires_at` is the session's **absolute** ceiling — rotation does not extend it
- Tokens live in the client's local storage, not in an HTTP-only cookie (the client is a Tauri desktop app, where same-origin cookies have no equivalent)

## Client API (used by the user client)

### Authentication

```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
POST   /api/v1/auth/oauth/{provider}    # OAuth callback
```

`POST /api/v1/auth/login` request:

```json
{
  "username": "laowang",
  "password": "...",
  "device_id": "ios-abc123",
  "device_info": { "platform": "ios", "model": "iPhone 15", "os": "17.1" }
}
```

Response:

```json
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "expires_in": 900,
  "user": { /* User object */ }
}
```

### User and Agent configuration

```
GET    /api/v1/users/me
PATCH  /api/v1/users/me
GET    /api/v1/agents/me
PATCH  /api/v1/agents/me
PUT    /api/v1/agents/me/policies
GET    /api/v1/agents/me/llm-keys      # whether each provider is configured (returns booleans only, never a key)
PUT    /api/v1/agents/me/llm-keys      # stores LLM API keys encrypted
DELETE /api/v1/agents/me/llm-keys/{provider}
GET    /api/v1/agents/me/llm-keys/{provider}/models   # asks the vendor live which models it offers
```

`provider` values come from the provider catalogue in `@confer/shared` (`packages/shared/src/llm/catalog.ts`), plus the tool service `tavily`. The gateway, agent-runtime and the client all read that catalogue: the base URL, the models-list path and the default model are written in that one place, so adding a vendor means touching the catalogue and nothing else.

`/models` forwards the vendor's own model list and never returns a list maintained locally:

```jsonc
{ "models": [{ "id": "gpt-4o" }] }
// an empty list always carries its reason; the four are distinct and each calls for a different remedy
{ "models": [], "error": "no_key" }        // no key configured for this provider yet
{ "models": [], "error": "unauthorized" }  // the vendor rejected the key (401/403)
{ "models": [], "error": "unreachable" }   // the vendor could not be reached, or returned some other error
{ "models": [], "error": "unsupported" }   // this vendor offers no models-list endpoint
```

### Contacts / peer Agents

```
GET    /api/v1/contacts                     # list contacts. Pagination: ?limit=&offset=
POST   /api/v1/contacts                     # add a contact
GET    /api/v1/contacts/{contact_id}        # one contact in detail (with its peer)
DELETE /api/v1/contacts/{contact_id}
PATCH  /api/v1/contacts/{contact_id}        # partially update alias / tags / pinned / muted (omitted fields are not cleared)

POST   /api/v1/contacts/lookup              # look up by DID / domain / username
```

`POST /api/v1/contacts/lookup` request:

```json
{
  "method": "domain",          // domain | did | username | qr_code | phone
  "value": "abc-industries.com"
}
```

`GET /api/v1/contacts` returns `{ contacts, total }`. `limit` defaults to 50 and caps at 100, `offset` defaults to 0; rows are ordered by `id` (a ULID) descending, newest first — a unique, deterministic order is exactly what keeps the offset window from skipping or repeating rows. `total` is the full count, not the size of this page, and it is how the client knows it has reached the end. A `limit` or `offset` that cannot be parsed falls back to the default rather than erroring.

Response: the list of candidate Agents found. Lookup **persists the peers it discovers into `peer_agents`** and attaches each candidate's local `id` (`peer_id`) — and that `id` is precisely what `POST /api/v1/contacts` uses to add the contact. `POST /contacts` is idempotent: adding the same peer twice returns the existing contact (`200`) rather than an error.

> Adding a contact is **the receiving side's consent that the other party may consume its Agent**: only a peer added as a contact can make my Agent answer (and spend my LLM budget). A2A messages from an unconnected peer are held as a connection request awaiting approval — see "The connection consent gate" in `03-protocol.md`.

```
POST   /api/v1/contacts/{contact_id}/policies   # set standing policies (whole-object replacement, PUT semantics)
```

The body of `POST /contacts/{id}/policies` is the runtime shape `{ default?: 'allow'|'ask_user'|'deny', rules?: [{ action, peer_did?, decision }] }` and is written wholesale into `peer_contacts.policy_overrides_json`. **Merge semantics**: when deciding an inbound A2A request, this per-contact override layers on top of the agent-level policy — a present `contact.default` replaces the agent default, and `contact.rules` are prepended to the agent's rules so they match first (a precise per-contact rule beats a general agent rule). An empty override `{}` is the identity: the decision is byte-for-byte the one you would get with no override at all.

### Conversations

```
GET    /api/v1/conversations                       # list my conversations (for the home screen)
POST   /api/v1/conversations                       # create a conversation
GET    /api/v1/conversations/{id}
PATCH  /api/v1/conversations/{id}
DELETE /api/v1/conversations/{id}

GET    /api/v1/conversations/{id}/messages         # pagination: ?before=&limit=
POST   /api/v1/conversations/{id}/messages         # send a message
GET    /api/v1/conversations/{id}/messages/{msg_id}/stream    # receive the LLM's reply as an SSE stream

POST   /api/v1/conversations/{id}/participants     # add a participant
DELETE /api/v1/conversations/{id}/participants/{p_id}

POST   /api/v1/conversations/{id}/read             # mark as read
```

`POST /api/v1/conversations/{id}/messages` request:

```json
{
  "content_type": "text",
  "content": "Which function code does the X100's 0x40 register use?",
  "in_reply_to": null,
  "via": "web"
}
```

Response:

```json
{
  "id": "01HXKQ...",
  "delivery_status": "queued",
  "stream_url": "/api/v1/conversations/01HX.../messages/01HXK.../stream"
}
```

### Permission management

```
GET    /api/v1/permissions/pending               # pending L2/L3 requests
POST   /api/v1/permissions/{id}/decide           # approve or deny
GET    /api/v1/permissions/history               # history
```

`POST /api/v1/permissions/{id}/decide` request:

```json
{
  "decision": "allow_always",       // allow_once | allow_always | deny | deny_always
  "scope": "peer_action"            // scope of the decision
}
```

Among the pending requests, those with `action='connect'` are **connection requests** (generated by the inbound A2A path when an unknown peer makes first contact). Approving (`allow_*`) writes that peer into `peer_contacts` and establishes the connection; denying does not.

Those with `action='ask'` are **pending questions from an already-connected peer** — the inbound A2A path generates them when the Agent's policy resolves to `ask_user` for that question (see "Pending inbox (answering while away)" in `03-protocol.md`). Approving (`allow_*`) makes the Agent answer the suspended question; denying leaves it unanswered.

`GET /pending` attaches a `description` to each request (a connection request carries who started it and their first message; a question carries who asked and the text) so the owner has something to judge by.

### Project memory (part of the Claude Code integration)

```
GET    /api/v1/projects/{project_id}/peers              # peers with memory in this project (name/did joined in)  ✅ implemented
POST   /api/v1/projects/{project_id}/peers              # register a peer into the project explicitly   🔜 backlog
GET    /api/v1/projects/{project_id}/peers/{peer_id}/facts        # ✅ implemented
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/facts        # ✅ implemented
GET    /api/v1/projects/{project_id}/peers/{peer_id}/decisions    # ✅ implemented
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/decisions    # ✅ implemented
```

Semantics (v0.1):

- Every query is scoped to `user.sub` (cross-user isolation).
- Before a PUT, the peer is checked to be a contact of that user (`peer_contacts`); if not, `403 not_a_contact` is returned.
- PUT upserts: the first write sets `version=1`, each later one increments `version` and refreshes `updated_at`. `facts` and `decisions` are independent — writing one section does not clear the other.
- `GET facts/decisions` returns `200`, an empty string and `version:0` when that (project, peer) pair has no memory yet — not a 404, because "this peer has left nothing behind yet" is a normal state on read.
- `project_id` is validated against `^[a-zA-Z0-9._\-/]+$` (1–255 characters); anything else returns `400 invalid_project_id`.
- `GET peers` returns an empty array on an empty project. The (project, peer) relationship is created implicitly by PUTting facts/decisions (there is no explicit `POST peers` registration in this phase).

### Knowledge base (RAG)

```
GET    /api/v1/knowledge-bases                                  # list my knowledge bases
POST   /api/v1/knowledge-bases                                  # create one
PATCH  /api/v1/knowledge-bases/{kb_id}                          # rename/redescribe, and whether it is open to external Agents
DELETE /api/v1/knowledge-bases/{kb_id}                          # delete it along with every document and vector in it

GET    /api/v1/knowledge-bases/{kb_id}/documents                # pagination: ?limit=&offset=
POST   /api/v1/knowledge-bases/{kb_id}/documents                # multipart upload, field named file
DELETE /api/v1/knowledge-bases/{kb_id}/documents/{doc_id}
POST   /api/v1/knowledge-bases/{kb_id}/documents/{doc_id}/retry # re-index
```

The body of `POST /knowledge-bases` is `{ name, description? }` (`name` 1–255 characters); the response is `201` with `{ knowledge_base }`.

The body of `PATCH /knowledge-bases/{kb_id}` is `{ name?, description?, shared_with_peers? }`; the response is `{ knowledge_base }`. **`shared_with_peers` can only be changed here and is not accepted at creation**: every base is born "mine only", and opening it outward is a second, deliberate act.

What `shared_with_peers` decides is **whether an inbound A2A question can search this base**, and it defaults to `false`. It does not affect the owner talking in the browser: they always search everything. This boundary has to fall on the scope of retrieval rather than in the prompt: the peer's question and the owner's instructions reach the model as the same kind of text, so "the Agent will judge what it should reveal" is no boundary at all. For the same reason an inbound A2A question **recalls no long-term memory**: long-term memory is distilled from the owner's own conversations, and not one entry of it is marked as fit to leave this instance.

`GET /knowledge-bases` returns `{ knowledge_bases }` and is **not paginated**: a user's bases are created by hand and bounded in number.

`GET /{kb_id}/documents` returns `{ documents, total }`. `limit` defaults to 50 and caps at 100, `offset` defaults to 0; ordered by `id` (a ULID) descending, newest first — a unique, deterministic order is what keeps the offset window from skipping or repeating rows. `total` is the full count, not the size of this page. An unparseable `limit` or `offset` falls back to the default rather than erroring. This is the only list in this section that grows without bound, because the knowledge base is exactly where uploads go.

Uploads go through `multipart/form-data`, the file field is always called `file`, and a single file is capped at **10 MB** (beyond that, `400 bad_request`). `Content-Type` is taken from the form when present and inferred from the extension when absent. The response is `201` with `{ document }`, and `status` is already `processing` by then: **chunking, embedding and writing to Qdrant all run asynchronously after the response**, and the upload endpoint does not wait for them. The client therefore polls the document list until `status` changes.

`status` values:

| Value | Meaning |
|---|---|
| `processing` | Stored; being chunked and embedded. The initial state after both an upload and a retry |
| `ready` | Searchable. `chunk_count` is the number of chunks for that document |
| `failed` | Indexing failed (parsing, a missing embedding key, or a failed write to the vector store) |

`POST /{doc_id}/retry` fetches the original file back from object storage and re-indexes it, clearing that document's existing vectors first so no duplicate chunks appear. It returns `400` if the original file is gone (`storage_key` empty) or the document is still `processing`. The response is `{ document }`, with `status` reset to `processing` and `chunk_count` back to zero.

Deleting a knowledge base cascades to every document row and every vector in Qdrant; deleting a single document also cleans up its vectors and its original file in object storage. A failed vector or object cleanup does not block the database delete — an orphaned object is better than a row pointing at data that is already gone.

Every endpoint is scoped to `user.sub`: reaching for someone else's base or document returns `404` (not `403`, which would leak its existence).

> The reverse proxy has to allow 10 MB bodies. `infra/nginx.conf` sets `client_max_body_size 10m` on `/api/`; at nginx's own default of 1 MB, files between 1 and 10 MB never reach the gateway at all and the browser gets nginx's own 413 page.

### Attachments

```
POST   /api/v1/attachments                       # multipart upload
GET    /api/v1/attachments/{id}                  # download (302 to a signed URL)
DELETE /api/v1/attachments/{id}
```

## WebSocket

### Endpoint

```
WSS  /ws?token=<access_token>&device_id=<device_id>
```

Handshake authentication is identical to REST, not "the signature checks out, let it through": `typ` must be `access`, `sid` must point at a session that still exists, and the account must not be `disabled`. All three are needed — without them a banned account only needs an unexpired token to keep reconnecting and receiving messages, while the ban itself (deleting every session) revokes nothing on this path. Banning also **closes the sockets that user already has open**: nginx gives `/ws` a `proxy_read_timeout` of a day, and stopping the next handshake does not stop an established connection.

### Message format

Every WS message is JSON and carries a `type` field:

```json
{ "type": "message.new", "data": { /* ... */ } }
```

### Client → server

```
ping                          // heartbeat
subscribe.conversation        // subscribe to a conversation (the server verifies participation)
unsubscribe.conversation
typing.start                  // only takes effect on conversations already subscribed to
typing.stop
read.ack                      // read receipt
```

`typing.*` is broadcast according to that socket's subscription set. When subscription has a gate and typing events do not, knowing a single conversation id is enough to inject "so-and-so is typing" into it — under your own username, at that.

### Server → client

```
pong
message.new                   // new message
message.updated
message.deleted
typing.update                 // who is typing
presence.update               // a contact came online or went offline
permission.request            // a permission request the user must decide
agent.status                  // what my Agent is doing ("consulting ABC's Agent…")
conversation.updated
```

`message.new` example:

```json
{
  "type": "message.new",
  "data": {
    "id": "01HXKQ...",
    "conversation_id": "01HX...",
    "sender_type": "peer_agent",
    "sender_id": "01HY...",
    "sender_did": "did:web:acme.com:agents:support",
    "content_type": "text",
    "content": "Use 0x03, Read Holding Registers…",
    "citations": [
      {
        "source": "X100 communications manual v3.2",
        "page": 87,
        "url": "https://acme.com/manuals/x100-v3.2.pdf#page=87",
        "trust_level": "authoritative"
      }
    ],
    "language": "en",
    "created_at": "2024-11-15T14:30:00Z"
  }
}
```

`permission.request` example:

```json
{
  "type": "permission.request",
  "data": {
    "id": "01HXP...",
    "level": "L2",
    "action": "share_files",
    "scope": {
      "peer": "did:web:acme.com:agents:support",
      "paths": ["src/modbus/"],
      "exclude": [".env", "secrets/"]
    },
    "peer_name": "ABC Agent",
    "peer_did": "did:web:acme.com:agents:support",
    "requested_at": "2024-11-15T14:30:00Z"
  }
}
```

**There is no `description` in the payload, and that is deliberate.** The server does not know what language the reader uses, so it sends structured facts only (`action` + the peer's identity + the stored `scope`), and the sentence read at approval time is composed by the client from its i18n (`packages/client/src/lib/permission-text.ts`). This contract is owned outright by `permissionRequestEventSchema` in `@confer/shared`: the gateway parses with it before sending, the client parses with it on receipt.

Every row from `GET /api/v1/permissions/pending` has that same shape (plus a `decision` field) and comes from the same constructor, so a row obtained by polling and a row pushed over the socket match byte for byte.

## SSE (LLM streaming)

```
GET  /api/v1/conversations/{id}/messages/{msg_id}/stream
Accept: text/event-stream
```

Event types:

```
event: token
data: {"text":"Use "}

event: token
data: {"text":"0x03 "}

event: tool_call
data: {"tool":"agent_network.ask_peer","args":{...}}

event: tool_result
data: {"result":"..."}

event: citation
data: {"source":"X100 communications manual v3.2","page":87}

event: done
data: {"finish_reason":"stop","tokens_used":523}
```

## A2A API (outward-facing, called by other Confer instances)

See `docs/03-protocol.md`. Only the endpoints are listed here.

Two bindings live under the same prefix and pass through the same gates (`a2a/inbound.ts`); only the wire format differs.

**The standard A2A HTTP+JSON binding** (paths copied verbatim from §11.3 of the specification; this is the one the Agent Card advertises):

```
POST   /a2a/v1/message:send              # SendMessage → Task
GET    /a2a/v1/tasks/{id}                # GetTask
GET    /a2a/v1/tasks                     # ListTasks (cursor pagination)
POST   /a2a/v1/tasks/{id}:cancel         # CancelTask → TaskNotCancelable
POST   /a2a/v1/message:stream            # not implemented → UnsupportedOperation
POST   /a2a/v1/tasks/{id}:subscribe      # not implemented → UnsupportedOperation
GET    /a2a/v1/extendedAgentCard         # not implemented → UnsupportedOperation
*      /a2a/v1/tasks/{id}/pushNotificationConfigs…  # → PushNotificationNotSupported
```

**Confer's own dialect** (instance to instance; discovered through `/.well-known/agents.json`):

```
POST   /a2a/v1/messages                  # receives messages from external Agents
GET    /a2a/v1/stream/{message_id}       # pulls the answer as a stream (SSE)
GET    /a2a/v1/agent-facts/{agent_did}   # public AgentFacts
```

Every A2A endpoint requires HTTP Message Signature verification.

## .well-known endpoints

```
GET    /.well-known/did.json                # the primary DID document
GET    /.well-known/agents.json             # every public Agent on this instance
GET    /.well-known/agent-card.json         # the standard A2A Agent Card (only when the instance has exactly one public Agent)
GET    /.well-known/openid-configuration    # future: OIDC compatibility (v2)
```

## Standard A2A Agent Card (the interoperable discovery layer)

```
GET    /agents/{username}/agent-card.json   # that Agent's standard A2A Card
GET    /.well-known/agent-card.json         # the same, only when this instance has exactly one public Agent
```

Follows the `AgentCard` of the Linux Foundation's **Agent2Agent v1.0** (fields taken from `specification/a2a.proto` in `a2aproject/A2A` @ v1.0.1, under the proto3 JSON mapping, hence camelCase). The point is to let the A2A ecosystem **discover** this instance's Agents: the names lined up but the protocols did not, because the other side's discovery document lives at `/.well-known/agent-card.json` while this instance had only `/.well-known/agents.json`.

A few deliberate trade-offs:

- **One Card per Agent**, with `supportedInterfaces[].tenant` = the username. The spec's well-known assumes one Agent per domain, and this instance is multi-tenant; `tenant` is precisely the routing selector the spec defines for "several Agents behind one A2A endpoint". `/.well-known/agent-card.json` answers only when there is **exactly one public Agent** (the solo self-hosting case); otherwise it 404s and points at `agents.json` in the error message — picking an arbitrary account and calling it "this domain's Agent" would simply be false.
- **`streaming: false`**. Streaming endpoints do exist, but in Confer's own shape, not the spec's `SendStreamingMessage`. Advertising a capability a standard client cannot use is worse than advertising nothing.
- **No `securitySchemes` declared**. What the spec offers there is API key, HTTP auth, OAuth2, OIDC or mTLS, and this endpoint accepts none of them: what it wants is a signed request. Filling in an arbitrary one would be telling the client it may authenticate in a way that is certain to be rejected. The real requirement is declared as a **required extension** (`capabilities.extensions`, with the RFC 9421 address as `uri` and `required: true`), which is exactly the mechanism the spec provides for this.
- The Card is a **discovery document**, and its visibility is identical to that of `/.well-known/agents.json`: a non-public or disabled Agent always 404s, or this route would become a way to enumerate accounts their owner never meant to publish.

- **Only one binding is advertised.** Confer's own dialect lives under this same URL but is not written into the Card: §5.1 requires every binding an Agent declares to be functionally equivalent, and the dialect has no task lifecycle. It is discovered through `/.well-known/agents.json`, so the Card promises nothing it cannot keep.

### Message layer (Task semantics)

`POST /a2a/v1/message:send` takes the spec's `SendMessageRequest` and returns a `Task`. **A task IS one inbound question**: its `id` is that message's id, its `contextId` is the conversation that archives it, and its state is derived from what happens next — no separate `tasks` table shadowing the same fact.

Confer's asynchronous, consent-gated model lands exactly on the spec's state machine:

| Situation | State |
|---|---|
| The Agent is answering | `TASK_STATE_WORKING` |
| Answered | `TASK_STATE_COMPLETED` |
| This turn cannot even start (no model configured, or the provider errored) | `TASK_STATE_FAILED` |
| Suspended by the `ask_user` policy, awaiting the owner | `TASK_STATE_AUTH_REQUIRED` (an interrupted state, not a terminal one) |
| The owner declined | `TASK_STATE_REJECTED` |

Two outcomes have **no** task to return, because no row was ever created: the unknown peer (held as a pending connection request) and an outright policy denial. Both answer `403 PERMISSION_DENIED` and are told apart by `ErrorInfo.metadata.confer_status` — minting a task id that would 404 on the next call is worse.

The rest lines up with the spec point by point: the error body is `google.rpc.Status`-shaped and **always** carries `ErrorInfo.reason` (several A2A errors share one HTTP status code, and `reason` is the only field that separates them); a client that has not declared the required extension gets `ExtensionSupportRequiredError` per §3.3.4 rather than a 401 that explains nothing; `historyLength=0` means **omitting the field entirely**, not sending an empty array; and `nextPageToken` is always present, an empty string when there is no next page.

Two deliberate deviations, both noted in the code: the blocking `message:send` wait **is bounded** (55s, after which the still-`WORKING` task is returned for the client to poll) — §3.2.2 offers no timeout exit, and an LLM call has no upper bound; and `messageId` idempotency (a MAY in §3.3.1) **is not implemented**, because a tenant-safe unique key needs owner scope, which the first message's wire format does not carry.

## Webhooks (optional, v1.5+)

Let external systems subscribe to events:

```
POST   /api/v1/webhooks
GET    /api/v1/webhooks
DELETE /api/v1/webhooks/{id}
```

Supported events: `message.new.peer`, `permission.granted`, `thread.archived`.

## Rate-limit policy

| Route | Limit |
|---|---|
| `/api/v1/auth/login` | 10/minute per IP |
| `/api/v1/auth/register` | 3/hour per IP |
| `/api/v1/conversations/*/messages` POST | 60/minute per user |
| `/a2a/v1/*` | 100/minute per peer-domain (higher when whitelisted) |
| WSS | at most 10 concurrent connections per user |

Response when the limit is exceeded:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
Content-Type: application/json

{ "error": { "code": "rate_limited", "message": "Too many requests" } }
```

## Consult API (user-initiated outbound A2A)

Lets the user (or an MCP server acting for them) put a question of their own to a peer agent **that is already a contact**, and collect the asynchronous reply afterwards. Signing and delivery happen entirely inside the gateway; the private key never leaves it.

> How this differs from the "conversations API": `/api/v1/conversations` + `/api/v1/stream` is talking to **your own local LLM assistant**; `/api/v1/consult` is what goes out over A2A to **somebody else's agent**.

### POST `/api/v1/consult/:peerId`

Starts or continues a `type='consult'` conversation (one per peer, reused), then signs and delivers a `message.type='question'`.

```jsonc
// request body (consultRequestSchema)
{ "question": "How do I rotate keys?", "code_context": "…optional code…", "language": "en" }
```

| Response | Meaning |
|------|------|
| `201 { conversation_id, message_id, status: "sent" }` | signed and delivered |
| `502 { ..., status: "failed", error }` | delivery failed (peer offline, no endpoint, or a signature problem) |
| `403 not_a_contact` | the peer is not a contact of the current user |

### GET `/api/v1/consult/:conversationId/reply?after=:messageId&wait=:seconds`

Long-polls for the peer's asynchronous reply (it arrives on inbound `/a2a/v1/messages` carrying its `thread_id`, and the gateway hangs it back on the matching thread). `wait` is capped at 55s.

- `200 { status: "answered", message }` — the reply arrived
- `200 { status: "pending" }` — timed out with no reply; poll again later

### GET `/api/v1/consult/:conversationId`

Returns the full message history of that consult thread (200 messages at most).

> Contract: inbound A2A triggers the local agent's automatic reply only for `message.type==='question'`; `answer` and `notification` are merely stored and broadcast, so that a consult reply cannot set off an endless exchange.
