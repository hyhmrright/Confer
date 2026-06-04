# Confer — Protocol design

Defines all protocols between Confer instances, and between the user client and the server. Every protocol is built on open standards to ease future federation.

## Agent identity

### DID:web format

Each user/enterprise instance hosts its own DID document:

```
https://acme.com/.well-known/did.json
```

DID document structure (W3C DID v1.0 compatible):

```json
{
  "@context": ["https://www.w3.org/ns/did/v1"],
  "id": "did:web:acme.com",
  "verificationMethod": [
    {
      "id": "did:web:acme.com#key-1",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:web:acme.com",
      "publicKeyMultibase": "z6MkpTHR8VNsBxYAAWHut2Geadd9jSrue..."
    }
  ],
  "service": [
    {
      "id": "did:web:acme.com#confer-agent",
      "type": "ConferAgent",
      "serviceEndpoint": "https://acme.com/a2a/v1"
    }
  ]
}
```

The DID form of a user Agent: `did:web:acme.com:agents:laowang` — primary instance + path segment. This lets a single instance host multiple users.

### Key rotation

- The DID document supports declaring multiple verification methods for smooth rotation
- Old keys are retained for at least 30 days (to prevent in-flight requests from failing)
- Revocation is done by removing the verification method from the document

## AgentFacts (NANDA-compatible)

Each Agent publishes an AgentFacts document describing itself. Location:

```
https://acme.com/agents/{slug}/agent.json
```

Or the well-known master directory:

```
https://acme.com/.well-known/agents.json
```

Example structure:

```json
{
  "@context": "https://nanda.dev/schemas/agent/v1",
  "did": "did:web:acme.com:agents:support",
  "name": "ABC Industries Support Agent",
  "description": "Technical support for X100, X200 industrial controllers",
  "owner": {
    "type": "Organization",
    "name": "ABC Industries Ltd.",
    "url": "https://acme.com"
  },
  "capabilities": [
    {
      "type": "qa",
      "scope": ["X100", "X200", "Modbus", "RTU", "TCP"],
      "languages": ["en", "zh", "de"]
    },
    {
      "type": "code-generation",
      "scope": ["python", "c", "embedded"],
      "languages": ["en", "zh"]
    }
  ],
  "endpoints": {
    "a2a": "https://acme.com/a2a/v1",
    "stream": "https://acme.com/a2a/v1/stream"
  },
  "trust": {
    "verifiedBy": ["did:web:nanda.org"],
    "issuedAt": "2024-10-01T00:00:00Z"
  },
  "publicKey": {
    "id": "did:web:acme.com#key-1",
    "type": "Ed25519VerificationKey2020"
  }
}
```

Field descriptions:

- `capabilities`: declares what this Agent can do. Claude Code uses the `scope` field for keyword routing (automatically consults this Agent when writing X100-related code)
- `languages`: supported languages. Used for the translation policy
- `trust.verifiedBy`: third-party trust endorsement (optional, to be provided by NANDA in the future)
- `publicKey`: the signing public key for A2A communication

## A2A protocol

### Protocol layer

All A2A communication goes over HTTPS POST/GET, encoded as JSON.

**Key point: use HTTP Message Signatures (RFC 9421) instead of bearer tokens**. Reasons:

- A bearer token becomes void the moment it is intercepted
- An HTTP signature is bound to a specific request (method + path + body digest + timestamp)
- It cannot be replayed; verifying the signature confirms the sender's identity

### Inbound request example

```http
POST /a2a/v1/messages HTTP/1.1
Host: acme.com
Content-Type: application/json
Date: Sun, 24 Nov 2024 14:30:00 GMT
Digest: SHA-256=X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=
Signature: keyId="did:web:vendor-x.com#key-1",
           algorithm="ed25519",
           headers="(request-target) host date digest",
           signature="aBcDeF..."
Authorization: Capability eyJhbGciOiJFZDI1NTE5IiwidHlwIjoiQ2FwIn0...

{
  "from": "did:web:vendor-x.com:agents:engineer-li",
  "to": "did:web:acme.com:agents:support",
  "thread_id": "thread_8f3a9c",
  "message": {
    "type": "question",
    "content": "X100 在 RTU 模式下的电压范围？",
    "language": "zh",
    "context": {
      "via": "claude-code",
      "project_hint": "modbus integration"
    }
  }
}
```

### Verification flow (receiver)

1. Parse the `Signature` header
2. Extract the `keyId` (which contains the DID)
3. Fetch the DID document (with caching: ETag + 60s TTL)
4. Retrieve the public key and verify the signature
5. Verify that `Digest` matches the body hash
6. Check that `Date` is within 5 minutes (replay protection)
7. Verify the `Capability` token (macaroon-style, detailed below)
8. **Connection consent gate**: has the sender already been added as a contact by the receiver? Not connected → do not run the LLM; hold it as a connection request (see below)
9. Connected → go through the policy engine to decide whether to respond

### Capability token

A capability token lets the sending Agent state "I am acting on behalf of user X to ask about a question of type Y", allowing fine-grained restriction of permissions.

JWT-style but using the macaroon approach:

```json
{
  "iss": "did:web:vendor-x.com",
  "sub": "did:web:vendor-x.com:users:engineer-li",
  "aud": "did:web:acme.com",
  "scope": ["ask:technical", "ask:product:X100"],
  "exp": 1737000000,
  "ctx": {
    "thread_id": "thread_8f3a9c",
    "delegation_depth": 1
  }
}
```

- `scope`: what types of questions can be asked
- `delegation_depth`: how many times it has been forwarded by a proxy (prevents infinite chaining)

### Streaming the response

The LLM generates the answer as a stream, and A2A also supports SSE:

```http
GET /a2a/v1/stream/{message_id} HTTP/1.1
Host: acme.com
Signature: ...
```

Returns `text/event-stream`:

```
event: token
data: {"text": "X100 "}

event: token
data: {"text": "在 RTU "}

event: citation
data: {"source": "X100 安装手册 p.12", "url": "..."}

event: done
data: {"thread_id": "thread_8f3a9c"}
```

## Permission model (Claude Code-inspired)

A three-tier permission hierarchy:

### L1 - Automatic (no confirmation needed)

- My Agent reads my own data
- The other party's Agent answers questions by citing its own documents
- Pure query-type conversations between Agents (no side effects, no data sharing)

### L2 - Ask once

- Sharing a directory/file with the other party's Agent
- Letting the other party's Agent see my conversation context
- Forwarding data across instances
- Enabling a tool (first-time activation)

UI presentation: a permission card pops up with 4 options:
- Allow this time
- Always allow (scoped to peer + range)
- View details
- Deny

### L3 - Explicit consent (asked every time)

- My Agent accepts invitations, makes payments, or signs contracts on my behalf
- Irreversible operations (deletion, transfer, external commitments)
- Commitments involving money/legal matters

UI presentation: a modal dialog + a detailed list of actions + a countdown (to prevent misclicks).

### Standing policies

The user can set rules in advance that override the default behavior:

```yaml
peer.acme-industries:
  allow:
    - read: "src/modbus/**"
    - ask: "technical:*"
  deny:
    - read: ".env"
    - read: "**/secrets/**"
    - ask: "personal:*"
  always_consult: true

peer.unknown:
  default: ask_user
  require_human_in_loop: true
```

### Connection consent gate

Answering an A2A message consumes the **receiver's** LLM budget. To prevent a stranger Agent from blasting messages without the owner's knowledge and burning through the owner's tokens, a connection is a precondition for consumption:

- **Connected peers** (in the receiver's `peer_contacts`) → the connection itself is consent; processed normally through the policy engine.
- **Unconnected peers** → `POST /a2a/v1/messages` returns `202`, with body `{ "status": "pending_connection" }`; **no conversation is created, no message is stored, the LLM is not run**. At the same time, a pending connection request with `action='connect'` is dropped into the pending inbox (deduplicated by peer, so repeated messages do not spam it).
- In the permission inbox, the owner sees "Agent X requests to connect + first message"; **approving** writes it into `peer_contacts` (establishing the connection), after which that peer's messages are processed normally; **denying** does not establish a connection.

The model mirrors LinkedIn / enterprise federation: **the discovery layer is open** (anyone can read `agents.json` and AgentFacts), while **the interaction layer requires consent** (you can only consume the other party's compute after connecting).

There are two paths to becoming "connected":
1. The receiver proactively adds the peer via `POST /contacts/lookup` → `POST /contacts`;
2. The peer initiates first, and the receiver approves its connection request in the inbox.

### Pending inbox (offline auto-answer)

When the owner is offline and receives a question from a **connected** peer:

- Matches a standing policy → the Agent answers directly
- Not on the allowlist → held in the pending inbox; when the owner comes online, one click to approve/edit/deny
- High urgency → push a notification to the owner

## Federated discovery

### Domain lookup

Given the domain `acme.com`, the client:

1. Fetches `https://acme.com/.well-known/did.json` to get the primary DID
2. Fetches `https://acme.com/.well-known/agents.json` to list all public Agents under that domain
3. Picks one and adds it as a contact

### Public registry (v2+)

Integrate with the NANDA Index or a similar public registry, supporting:

- Search by capability ("find an Agent that understands Modbus")
- Search by organization ("find ABC Industries' Agent")
- Search by geographic location ("nearby service Agents")

### Trust graph (v2+)

- My friends' Agents rank higher
- Agents from my colleagues' companies rank higher
- Third-party endorsements (verified by NANDA) carry a trust badge

## Anti-spam

- Rate-limit each peer-domain per minute (Redis counter)
- Peers not on the allowlist default to low priority
- The user can blocklist a peer-domain
- Reputation scoring (v2+): how many other instances have flagged it as spam

## Translation policy

- Each Agent declares `primary_language` and `style` in its AgentFacts
- Cross-language conversations: translation is done **inside the target Agent** (it best understands its own terminology and documents)
- Quoted portions **always preserve the original text**: the user can view the authoritative wording before translation
- Default behavior is `preserve-style` (preserve style, swap only the language); consumer scenarios can declare `localize-style` (adapt to local conventions)

## Protocol evolution strategy

- Every protocol carries an `@context` or `version` field
- Both client and server maintain backward compatibility (accept unknown fields, ignore unknown fields)
- Breaking changes go through a major version bump (e.g. `/a2a/v2/`)
- Compatible with the schema evolution of NANDA and Google A2A (betting on the open ecosystem)
