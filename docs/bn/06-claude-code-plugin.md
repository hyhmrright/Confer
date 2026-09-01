# Confer — Claude Code-এর MCP প্লাগিন নকশা

Confer-কে Claude Code-এর MCP সার্ভার বানিয়ে দেওয়া, যাতে কোড লিখতে লিখতেই Claude Code সরাসরি সরবরাহকারী বা ভিতরের Agent-কে জিজ্ঞেস করতে পারে আর উত্তরগুলো প্রকল্পে জমা হয়। **এটিই Confer-এর নির্ণায়ক বৈশিষ্ট্য।**

## নকশার নীতি

কথাটা «একটা যন্ত্র ঝুলিয়ে দেওয়ার» নয়, Claude Code-কে **বিষয়-বিশেষজ্ঞদের একটি দল** দেওয়ার। প্রতিটি সরবরাহকারীর বিপরীতে থাকে দীর্ঘ স্মৃতিসম্পন্ন একজন «বিশেষজ্ঞ», আর জ্ঞান প্রকল্পে জমতে থাকে — session বদলালেও হারায় না।

নকশার পাঁচটি স্তম্ভ (কৌশলগত বিবরণ `docs/01-product.md`-এ):

1. Vendor specialist subagent — একজন স্থায়ী বিষয়-বিশেষজ্ঞ
2. প্রকল্প-স্তরে জ্ঞানের জমা — `.claude/peers/`
3. Pre-flight design review — কোড লেখার আগে বিশেষজ্ঞের কাছ দিয়ে যাওয়া
4. Post-flight code review — লেখা কোড বিশেষজ্ঞকে দিয়ে দেখানো
5. কর্তৃত্বের অগ্রাধিকার + পরিচয়ের স্বচ্ছতা — নিজের বিষয়ে সরবরাহকারীর রায় সাধারণ LLM-এর উপরে যায়

## স্থাপন

> নিচের `claude mcp add … @confer/mcp-server` ও OAuth হলো **লক্ষ্য-কল্পনা**। v0.1-এর আসল স্থাপন এই অংশের শেষে «বর্তমান বাস্তবায়ন (v0.1)»-এ আছে — আজ যা আছে তা হলো পরিবেশ-চলক দিয়ে প্রমাণীকরণ করা `confer-a2a` প্লাগিন।

```bash
# ব্যবহারকারীর চোখে (কল্পনা)
claude mcp add confer npx -y @confer/mcp-server

# প্রথমবার চালু হলে OAuth দিয়ে Confer অ্যাকাউন্ট জোড়ার পথ দেখায়
claude mcp config confer
# ইনস্ট্যান্স বাছুন: cloud.confer.ai কিংবা নিজের ইনস্ট্যান্সের URL
# OAuth প্রমাণীকরণের জন্য ব্রাউজারে নিয়ে যায়
```

বিন্যাস ফাইল (ব্যবহারকারী সম্পাদনা করেন):

```toml
# .claude/confer.toml

[instance]
url    = "https://cloud.confer.ai"
token  = "encrypted-by-keychain"

[defaults]
auto_consult = true               # মূল শব্দ পেলেই আপনা-আপনি জিজ্ঞেস করা
review_mode  = "post-flight"      # never | pre-flight | post-flight | both
language     = "bn"

[peer.abc-industries]
did       = "did:web:acme.com:agents:support"
authority = ["X100", "X200", "Modbus", "RTU", "TCP"]
trust     = "high"

[peer.internal-sdk]
did       = "did:web:mycompany.com:agents:sdk-team"
authority = ["powersupply-lib", "internal-bus", "auth-service"]
trust     = "high"
```

### বর্তমান বাস্তবায়ন (v0.1)

কল্পনার OAuth আর npx প্যাকেজ এখনও হয়নি। যা হয়েছে তা হলো **প্লাগিন marketplace থেকে এক ক্লিকে স্থাপন**, প্রমাণীকরণ পরিবেশ-চলক দিয়ে (স্বাক্ষরের ব্যক্তিগত চাবি সবসময় গেটওয়েতেই থাকে, নিচে নামে না):

```bash
# 1. marketplace যোগ করে প্লাগিন বসান (এই রিপোজিটরিই marketplace)
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer

# 2. shell-এ অ্যাকাউন্ট রপ্তানি করুন (প্লাগিন পরিবেশ থেকে পড়ে; পরিচয়পত্র রিপোজিটরিতে লেখা হয় না)
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
# ঐচ্ছিক: export CONFER_GATEWAY_URL=http://localhost:3000  (ডিফল্ট মান)
```

প্লাগিন সঙ্গে আনে একটি স্বয়ংসম্পূর্ণ bundle (`plugins/confer-a2a/dist/server.mjs`, খালি `node` দিয়েই চলে — monorepo লাগে না, `bun`-ও না), যা `packages/mcp-a2a` থেকে `bun run --filter @confer/mcp-a2a build:plugin` দিয়ে তৈরি হয়। এটি ১৫টি যন্ত্র দেয় (`list_agents` / `ask_agent` / `follow_up` / `ask_multiple` / `check_reply` প্রভৃতি); বিবরণ `plugins/confer-a2a/README.md` ও `packages/mcp-a2a/README.md`-এ।

যাঁরা রিপোজিটরির ভিতরে কাজ করেন তাঁরা প্লাগিন ছাড়াও চালাতে পারেন — সরাসরি মূলের `.mcp.json` (যা উৎসের `server.ts`-এর দিকে দেখায়) কিংবা `claude mcp add` দিয়ে।

## উন্মুক্ত করা MCP যন্ত্র

### `ask_peer`

কোনো peer Agent-কে প্রশ্ন করা।

```typescript
{
  name: "ask_peer",
  description: "Ask a peer Agent a question. Use this when you need vendor-specific or domain-specific knowledge that may not be in your training data.",
  inputSchema: {
    type: "object",
    properties: {
      peer: { type: "string", description: "Peer slug (e.g. 'abc-industries') or DID" },
      question: { type: "string" },
      context: { type: "string", description: "Optional context: what we're trying to do" },
      thread_id: { type: "string", description: "Continue an existing conversation" }
    },
    required: ["peer", "question"]
  }
}
```

ফেরায়:

```json
{
  "answer": "0x03, Read Holding Registers দিয়ে…",
  "citations": [{"source": "X100 যোগাযোগ নির্দেশিকা v3.2", "page": 87}],
  "thread_id": "thread_8f3a9c",
  "peer_did": "did:web:acme.com:agents:support",
  "latency_ms": 4231
}
```

### `list_peers`

এখন যেসব peer Agent পাওয়া যায় তার তালিকা।

```typescript
{
  name: "list_peers",
  description: "List peer Agents registered for this project, with their capabilities.",
  inputSchema: {
    type: "object",
    properties: {
      authority: { type: "string", description: "Filter by authority keyword (e.g. 'Modbus')" }
    }
  }
}
```

### `discover_peer`

নতুন peer Agent খুঁজে বার করা (ডোমেইন ধরে খোঁজ)।

```typescript
{
  name: "discover_peer",
  description: "Discover a peer Agent by domain or DID. Use this when the user mentions a vendor that's not yet registered.",
  inputSchema: {
    type: "object",
    properties: {
      domain: { type: "string", description: "e.g. 'abc-industries.com'" }
    },
    required: ["domain"]
  }
}
```

### `read_project_memory`

এই প্রকল্পে জমে থাকা জ্ঞান পড়া।

```typescript
{
  name: "read_project_memory",
  description: "Read accumulated facts and decisions for a peer in this project. Use this at the start of relevant tasks to load context.",
  inputSchema: {
    type: "object",
    properties: {
      peer: { type: "string" },
      section: { type: "string", enum: ["facts", "decisions", "conversations", "meta"] }
    },
    required: ["peer"]
  }
}
```

### `write_project_memory`

প্রকল্পের জ্ঞান লেখা (সাধারণত ask_peer-এর পরে আপনিই ডাকা হয়, হাতেও করা যায়)।

```typescript
{
  name: "write_project_memory",
  description: "Write a verified fact or decision to project memory. Auto-called after ask_peer for important answers.",
  inputSchema: {
    type: "object",
    properties: {
      peer: { type: "string" },
      section: { type: "string", enum: ["facts", "decisions"] },
      key: { type: "string", description: "Short identifier" },
      content: { type: "string", description: "Markdown content" },
      citations: { type: "array", items: { type: "object" } }
    },
    required: ["peer", "section", "key", "content"]
  }
}
```

### `request_design_review`

Pre-flight: নকশার পরিকল্পনা বিশেষজ্ঞের কাছ দিয়ে নেওয়া।

```typescript
{
  name: "request_design_review",
  description: "Submit a design plan to a peer Agent for review before implementing. Strongly recommended for non-trivial vendor-specific work.",
  inputSchema: {
    type: "object",
    properties: {
      peer: { type: "string" },
      plan: { type: "string", description: "Markdown-formatted plan" },
      scope: { type: "string", description: "What part of the system" }
    },
    required: ["peer", "plan"]
  }
}
```

### `request_code_review`

Post-flight: লেখা কোড বিশেষজ্ঞকে দিয়ে দেখানো।

```typescript
{
  name: "request_code_review",
  description: "Submit a code diff to a peer Agent for review after writing. Useful for catching vendor-specific gotchas.",
  inputSchema: {
    type: "object",
    properties: {
      peer: { type: "string" },
      files: { type: "array", items: { type: "object", properties: { path: {}, content: {} } } },
      focus: { type: "string", description: "What to focus on" }
    },
    required: ["peer", "files"]
  }
}
```

## উন্মুক্ত করা MCP resource

Claude Code এগুলোকে `@resource:…` রীতিতে উল্লেখ করতে পারে।

### `confer://peers/{peer_slug}/facts`

markdown আকারে facts ফাইল ফেরায়।

### `confer://peers/{peer_slug}/conversations/{thread_id}`

কোনো একটি কথোপকথনের পূর্ণ নথি ফেরায়।

### `confer://threads/{thread_id}`

মূল প্রোগ্রামের IM-এর কোনো কথোপকথন প্রসঙ্গ হিসেবে ফেরায় (ব্যবহারকারী IM-এ thread-এর URL কপি করে Claude Code-কে দিতে পারেন)।

## উন্মুক্ত করা MCP prompt

আগে থেকে বানানো prompt ছাঁচ, ব্যবহারকারী চটপট চালাতে পারেন।

### `consult-vendor`

```
"Help me design how to integrate {topic}. Before writing code,
consult the relevant vendor Agent via ask_peer, and load any
existing project memory."
```

### `verify-with-source`

```
"Review the current implementation in {file}. For each
vendor-specific decision, verify with the relevant peer Agent
and add citation comments where they're missing."
```

## স্বাধীন সিদ্ধান্তের আচরণ

Claude Code যখন Confer-এর MCP সার্ভারকে ডাকে, সার্ভার তাকে ইঙ্গিত দেয় যাতে সে আরও বুদ্ধি খাটিয়ে চলে:

### ask_peer আপনা-আপনি চালু হওয়ার সংকেত

```toml
[auto_consult.triggers]
keywords_match_authority = true        # কোডে বা কথোপকথনে peer.authority-র শব্দ এসেছে
explicit_uncertainty     = true        # যখন Claude Code বলে «I'm not sure»
import_vendor_lib        = true        # কোনো সরবরাহকারীর SDK আমদানি করা হয়েছে
```

বাস্তবায়নের ধরন: MCP সার্ভার যন্ত্রের বিবরণে ইঙ্গিত জুড়ে দেয় — যেমন `ask_peer`-এর বিবরণের শেষে:

> "Strongly prefer calling this over guessing for any question about: X100, X200, Modbus, RTU, TCP, PowerSupply-lib (from registered peers' authority lists)."

এই ইঙ্গিত দেখে Claude Code নিজেই ঠিক করে ডাকবে কি না।

### প্রকল্প-স্মৃতির স্বয়ংক্রিয় লেখা

প্রতিবার `ask_peer` সফল হলে MCP সার্ভার উত্তর থেকে «তথ্য» কাঠামোবদ্ধভাবে বার করে `facts.md`-এ লেখার চেষ্টা করে:

```
[after ask_peer succeeds]
→ MCP server analyzes the answer
→ if it contains structured facts (numbers, addresses, codes), extract
→ append to .claude/peers/{peer_slug}/facts.md with citation
→ return enriched response to Claude Code
```

## পরিচয়ের ভেদ করে যাওয়া

A2A অনুরোধে `via: claude-code` ছাপ থাকে:

```json
{
  "from": "did:web:cloud.confer.ai:users:laowang",
  "to":   "did:web:acme.com:agents:support",
  "context": {
    "via":        "claude-code",
    "project":    "modbus-integration",
    "intent":     "code-generation"
  },
  "message": { /* ... */ }
}
```

ওপাশের Agent `context.via` দেখে নিজের উত্তরের ধরন বদলাতে পারে:

- `via: claude-code` → কাঠামোবদ্ধ উত্তর (কোড ব্লক, JSON, স্পষ্ট ক্ষেত্র-নাম)
- `via: web` → স্বাভাবিক ভাষায় উত্তর, বেশি ব্যাখ্যা ও প্রসঙ্গ সহ
- `via: mobile` → সংক্ষিপ্ত, মূল কথা ফুটিয়ে, ছোট পর্দায় পড়ার উপযোগী

এই ইঙ্গিত বাধ্যতামূলক নয়, ওপাশের Agent একে অগ্রাহ্য করতে পারে। তবু সবাই মানলে ভালো।

## নিরাপত্তা ও আস্থা

### অনুমতির স্তর

MCP দিয়ে Claude Code-এর `ask_peer` ডাকা ডিফল্টে L1 (কেবল পড়ার পরামর্শ)। কিন্তু:

- `request_code_review` (peer-কে কোড দেওয়া) → L2, প্রথমবার ব্যবহারকারীকে জিজ্ঞেস করা হয়
- `share_files` (ফাইলের ডিরেক্টরি ভাগ করা) → L2
- `commit_on_behalf` (ব্যবহারকারীর হয়ে সিদ্ধান্ত) → L3, প্রতিবার জিজ্ঞেস করা হয়

অনুমতির অনুরোধ MCP সার্ভার মূল প্রোগ্রামে পাঠায়, মূল প্রোগ্রাম IM-এর পর্দায় অনুমতির কার্ড দেখায়, ব্যবহারকারী সিদ্ধান্ত নেন, আর ফল Claude Code-এ ফিরে গিয়ে কাজ এগোয়।

### আস্থার স্তর

- `peer.{slug}.trust = "high"` হলে সেই peer-এর উত্তর, তার কর্তৃত্বের সীমার ভিতরে, Claude Code-এর সাধারণ জ্ঞানের উপরে যায়
- `trust = "medium"` হলে উদ্ধৃতি নেওয়া হয় প্রসঙ্গ হিসেবে, তবে Claude Code তা চিহ্নিত করে দেয়
- `trust = "low"` হলে, কিংবা peer নতুন ও অযাচাইকৃত হলে, উদ্ধৃত ফল সবসময় ব্যবহারকারীর কাছে নিশ্চিত করে নেওয়া হয়

### গতি ও খরচ

MCP সার্ভারের স্থানীয় হার-সীমা:

- একটি Claude Code session-এ একই peer-কে সর্বোচ্চ ৫০ বার `ask_peer`
- জমা সীমা ছাড়ালে «চালিয়ে যাব?» জিজ্ঞাসা ভেসে ওঠে
- প্রতিটি ডাকের আনুমানিক খরচ দেখানো হয় (ওপাশের Agent যে মডেল ব্যবহার করে তার ভিত্তিতে)

## CLI আদেশ

পরিপূরক আদেশ, ব্যবহারকারী shell-এ চালান:

```bash
# নিবন্ধিত peer-এর তালিকা
confer peer list

# peer যোগ করুন
confer peer add abc-industries --did did:web:acme.com:agents:support
confer peer add abc-industries --domain acme.com    # well-known নিজেই দেখে নেয়

# প্রকল্পের স্মৃতি দেখুন
confer memory show abc-industries
confer memory show abc-industries --section facts

# সরাসরি কমান্ড লাইন থেকে জিজ্ঞেস করুন
confer ask abc-industries "RTU মোডে X100-এর ভোল্টেজের সীমা কত?"

# প্রকল্পের স্মৃতি Confer সার্ভারের সঙ্গে মেলান
confer sync push
confer sync pull
```

## MCP সার্ভার বাস্তবায়নের মূল কথা

প্রযুক্তির স্তূপ:

- Bun + TypeScript
- `@modelcontextprotocol/sdk`
- স্থানীয় SQLite ক্যাশ (যাতে প্রতিবার সার্ভারে যেতে না হয়)
- টোকেন Keychain / Credential Manager-এ

প্রধান ফাইল:

```
packages/mcp-server/
├── src/
│   ├── index.ts              # MCP সার্ভারের মূল প্রবেশপথ
│   ├── tools/
│   │   ├── ask-peer.ts
│   │   ├── list-peers.ts
│   │   ├── discover-peer.ts
│   │   ├── project-memory.ts
│   │   ├── design-review.ts
│   │   └── code-review.ts
│   ├── resources/
│   ├── prompts/
│   ├── client.ts             # Confer API ক্লায়েন্ট
│   ├── auth.ts               # OAuth প্রবাহ
│   ├── cache.ts              # স্থানীয় SQLite ক্যাশ
│   └── config.ts             # .claude/confer.toml পড়ে
└── package.json
```

প্রবেশপথের উদাহরণ:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import { tools } from "./tools";
import { resources } from "./resources";
import { prompts } from "./prompts";

const server = new Server(
  { name: "confer", version: "0.1.0" },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

tools.forEach((t) => server.setRequestHandler(t.schema, t.handler));
resources.forEach((r) => server.registerResource(r));
prompts.forEach((p) => server.registerPrompt(p));

const transport = new StdioServerTransport();
await server.connect(transport);
```

## গ্রহণের মানদণ্ড (v1)

- [ ] `claude mcp add confer` এক লাইনে বসিয়ে দেয়
- [ ] প্রথম চালুতে OAuth-এর পুরো বিন্যাস করিয়ে নেয়
- [ ] `ask_peer` শুরু থেকে শেষ পর্যন্ত ১০ সেকেন্ডের কম নেয় (LLM-এর ভাবার সময় ধরে)
- [ ] `read_project_memory` ১০০ মিলিসেকেন্ডের কম (স্থানীয় ক্যাশ মিললে)
- [ ] pre-flight পর্যালোচনায় Claude Code নিজের পরিকল্পনা শুধরে নেয়
- [ ] git কমিটের পর প্রকল্পের স্মৃতি রিপোজিটরির সঙ্গে চলে
- [ ] অন্তত একটি প্রকাশ্য সরবরাহকারী Agent পাওয়া যায় (ডেমোর জন্য: mock-vendor.confer.dev)

## বাস্তবায়নের অবস্থা (v0.1)

উপরের সবটাই পূর্ণ কল্পনা। মাটিতে নামা প্রথম সংস্করণ `packages/mcp-a2a` «peer agent-কে জিজ্ঞেস করা» — এই কেন্দ্রীয় বৃত্তটি সম্পূর্ণ করেছে:

**স্থাপত্য (দুই স্তর)**

- গেটওয়েতে ব্যবহারকারীর উদ্যোগে বাইরে যাওয়া A2A পরামর্শ যুক্ত হলো (`/api/v1/consult/*`, দেখুন `docs/05-api.md`)। এর আগে প্ল্যাটফর্মে A2A বার্তা পাঠানোর একটিই পথ ছিল — «ভিতরে আসা → স্বয়ংক্রিয় উত্তর» — ব্যবহারকারীর উদ্যোগে বাইরে যাওয়ার কোনো পথ ছিল না।
- `packages/mcp-a2a`: stdio-র উপর চলা MCP সার্ভার, যা **একটি বিন্যস্ত Confer ব্যবহারকারীর** পরিচয়ে গেটওয়েতে লগইন করে টোকেন নেয় এবং পরামর্শের ক্ষমতাকে যন্ত্র হিসেবে উন্মুক্ত করে। স্বাক্ষর এখনও গেটওয়েতেই হয়; ব্যক্তিগত চাবি গেটওয়ে ছাড়ে না।

**বাস্তবায়িত যন্ত্র (১৫টি)**

| ক্ষেত্র | যন্ত্র |
|----|------|
| আবিষ্কার | `list_agents` / `get_agent_capabilities` / `find_agents` |
| পরামর্শ | `ask_agent` (সমকালীন অপেক্ষা) / `follow_up` / `get_conversation` |
| অগ্রসর | `ask_multiple` (সমান্তরাল, সর্বোচ্চ ৫) / `check_reply` (অ্যাসিনক্রোনাসভাবে নেওয়া) |
| পরিচালনা | `whoami` |
| নির্দিষ্ট ব্যক্তি | `ask_person_agent` (নির্দিষ্ট কোনো ব্যক্তির agent-কে জিজ্ঞেস করা; Wizard ভরে দেয়) |
| প্রকল্প-স্মৃতি | `read_project_memory` (facts/decisions পড়ে; না থাকা মানে ফাঁকা, ত্রুটি নয়) / `write_project_memory` (facts বা decisions লেখে, একটি অন্যটিকে মোছে না, `version` বাড়ে) |
| আবিষ্কার + পর্যালোচনা | `discover_peer` (domain/did/username ধরে peer খুঁজে সংরক্ষণ করে ও `peer_id` ফেরায়; **পরিচিতির সম্পর্ক গড়ে না** — আগে মূল প্রোগ্রামে তাকে পরিচিত হিসেবে গ্রহণ করতে হবে, নইলে পরের স্মৃতি-লেখা বা পরামর্শ `403` খাবে; এটাই সম্মতির দরজা) / `request_design_review` (peer-কে পরিকল্পনা পর্যালোচনা করতে বলা) / `request_code_review` (peer-কে ফাইল পর্যালোচনা করতে বলা) |

স্মৃতির যন্ত্রগুলোর `project` পরামিতি বাদ দেওয়া যায়; বাদ দিলে MCP-তে বিন্যস্ত `projectId`-তে ফিরে আসে (`CONFER_PROJECT_ID` পরিবেশ-চলক, যার ডিফল্ট কাজের ডিরেক্টরির basename)।

**সংযোগ**

```jsonc
{
  "mcpServers": {
    "confer-a2a": {
      "command": "bun",
      "args": ["run", "packages/mcp-a2a/src/server.ts"],
      "env": {
        "CONFER_GATEWAY_URL": "http://localhost:3000",
        "CONFER_USERNAME": "${CONFER_USERNAME}",
        "CONFER_PASSWORD": "${CONFER_PASSWORD}",
        // ঐচ্ছিক: প্রকল্প-স্মৃতির পরিধি ঠিক করা id, ডিফল্টে কাজের ডিরেক্টরির নাম
        "CONFER_PROJECT_ID": "${CONFER_PROJECT_ID}"
      }
    }
  }
}
```

**কল্পনার সঙ্গে ফারাক (পরবর্তী)**: OAuth বন্ধন, vendor specialist-এর দীর্ঘ স্মৃতি ও `.claude/peers/`-এ জমা, pre/post-flight পর্যালোচনা এবং কর্তৃত্বের অগ্রাধিকার এখনও backlog-এ; আজ পরিচয় একটিই বিন্যস্ত ব্যবহারকারীর, উত্তর আসে দীর্ঘ অপেক্ষায়, আর ঝুলে থাকা অনুমতি আপাতত `pending` হিসেবেই দেখানো হয়।
