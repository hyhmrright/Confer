# Confer — Claude Code کے MCP پلگ اِن کا ڈیزائن

Confer کو Claude Code کا MCP سرور بنا دینا، تاکہ کوڈ لکھتے لکھتے Claude Code براہِ راست فراہم کنندہ یا اندرونی Agent سے پوچھ سکے اور جواب منصوبے میں جمع ہوتے جائیں۔ **یہی Confer کی فیصلہ کن خوبی ہے۔**

## ڈیزائن کے اصول

بات «ایک اوزار ٹانگ دینے» کی نہیں، Claude Code کو **شعبہ جاتی ماہرین کی ایک ٹیم** دینے کی ہے۔ ہر فراہم کنندہ کے مقابل ایک ایسا «ماہر» ہوتا ہے جس کی یادداشت دیرپا ہے، اور علم منصوبے میں جمع ہوتا رہتا ہے — session بدلنے پر ضائع نہیں ہوتا۔

ڈیزائن کے پانچ ستون (حکمتِ عملی کی تفصیل `docs/01-product.md` میں):

1. Vendor specialist subagent — ایک دیرپا شعبہ جاتی ماہر
2. منصوبے کی سطح پر علم کا جمع ہونا — `.claude/peers/`
3. Pre-flight design review — کوڈ لکھنے سے پہلے ماہر کے پاس سے گزرنا
4. Post-flight code review — لکھا ہوا کوڈ ماہر سے دیکھوانا
5. سند کی ترجیح + شناخت کی شفافیت — اپنے شعبے میں فراہم کنندہ کا فیصلہ عام LLM پر بھاری پڑتا ہے

## تنصیب

> نیچے دیا `claude mcp add … @confer/mcp-server` اور OAuth **ہدف کا تصور** ہے۔ v0.1 کی اصل تنصیب اس حصے کے آخر میں «موجودہ نفاذ (v0.1)» کے تحت ہے — آج جو موجود ہے وہ ماحول کے متغیرات سے توثیق کرنے والا `confer-a2a` پلگ اِن ہے۔

```bash
# صارف کی نظر سے (تصور)
claude mcp add confer npx -y @confer/mcp-server

# پہلی بار چلنے پر OAuth سے Confer کھاتہ جوڑنے کی رہنمائی کرتا ہے
claude mcp config confer
# انسٹنس چنیں: cloud.confer.ai یا اپنے انسٹنس کا URL
# OAuth توثیق کے لیے براؤزر پر لے جاتا ہے
```

ترتیب کی فائل (صارف اسے سنوارتا ہے):

```toml
# .claude/confer.toml

[instance]
url    = "https://cloud.confer.ai"
token  = "encrypted-by-keychain"

[defaults]
auto_consult = true               # کلیدی الفاظ ملتے ہی خود بخود پوچھ لینا
review_mode  = "post-flight"      # never | pre-flight | post-flight | both
language     = "ur"

[peer.abc-industries]
did       = "did:web:acme.com:agents:support"
authority = ["X100", "X200", "Modbus", "RTU", "TCP"]
trust     = "high"

[peer.internal-sdk]
did       = "did:web:mycompany.com:agents:sdk-team"
authority = ["powersupply-lib", "internal-bus", "auth-service"]
trust     = "high"
```

### موجودہ نفاذ (v0.1)

تصور والا OAuth اور npx پیکج ابھی نہیں بنا۔ جو بن چکا ہے وہ ہے **پلگ اِن marketplace سے ایک کلک میں تنصیب**، جس میں توثیق ماحول کے متغیرات سے ہوتی ہے (دستخط کی نجی کلید ہمیشہ گیٹ وے ہی میں رہتی ہے، نیچے نہیں اترتی):

```bash
# 1. marketplace شامل کریں اور پلگ اِن نصب کریں (یہی ریپازٹری marketplace ہے)
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer

# 2. shell میں کھاتہ برآمد کریں (پلگ اِن اسے ماحول سے پڑھتا ہے؛ اسناد ریپازٹری میں نہیں لکھی جاتیں)
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
# اختیاری: export CONFER_GATEWAY_URL=http://localhost:3000  (طے شدہ قدر)
```

پلگ اِن اپنے ساتھ ایک خود کفیل bundle لاتا ہے (`plugins/confer-a2a/dist/server.mjs`، جو خالی `node` سے چل جاتا ہے — نہ monorepo چاہیے، نہ `bun`)، جو `packages/mcp-a2a` سے `bun run --filter @confer/mcp-a2a build:plugin` کے ذریعے بنتا ہے۔ یہ 15 اوزار دیتا ہے (`list_agents` / `ask_agent` / `follow_up` / `ask_multiple` / `check_reply` وغیرہ)؛ تفصیل `plugins/confer-a2a/README.md` اور `packages/mcp-a2a/README.md` میں۔

جو ریپازٹری کے اندر ترقی کرتے ہیں وہ پلگ اِن کے بغیر بھی کام چلا سکتے ہیں — سیدھا جڑ کی `.mcp.json` (جو ماخذ کے `server.ts` کی طرف اشارہ کرتی ہے) یا `claude mcp add` سے۔

## پیش کردہ MCP اوزار

### `ask_peer`

کسی peer Agent سے سوال پوچھنا۔

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

لوٹاتا ہے:

```json
{
  "answer": "0x03، یعنی Read Holding Registers سے…",
  "citations": [{"source": "X100 مواصلاتی دستی v3.2", "page": 87}],
  "thread_id": "thread_8f3a9c",
  "peer_did": "did:web:acme.com:agents:support",
  "latency_ms": 4231
}
```

### `list_peers`

اِس وقت دستیاب peer Agent کی فہرست۔

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

نیا peer Agent دریافت کرنا (ڈومین سے تلاش)۔

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

اس منصوبے میں جمع علم پڑھنا۔

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

منصوبے کا علم لکھنا (عموماً ask_peer کے بعد خود بخود پکارا جاتا ہے، ہاتھ سے بھی ہو سکتا ہے)۔

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

Pre-flight: ڈیزائن کا منصوبہ ماہر کے پاس سے گزارنا۔

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

Post-flight: لکھا ہوا کوڈ ماہر سے دیکھوانا۔

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

## پیش کردہ MCP resources

Claude Code انہیں `@resource:…` ساخت سے حوالہ دے سکتا ہے۔

### `confer://peers/{peer_slug}/facts`

markdown صورت میں facts فائل لوٹاتا ہے۔

### `confer://peers/{peer_slug}/conversations/{thread_id}`

کسی ایک گفتگو کا مکمل ریکارڈ لوٹاتا ہے۔

### `confer://threads/{thread_id}`

مرکزی پروگرام کے IM کی کوئی گفتگو سیاق کے طور پر لوٹاتا ہے (صارف IM میں thread کا URL نقل کر کے Claude Code کو دے سکتا ہے)۔

## پیش کردہ MCP prompts

پہلے سے بنے prompt سانچے، جنہیں صارف جھٹ پٹ چلا سکتا ہے۔

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

## خودمختار فیصلے کا رویہ

Claude Code جب Confer کے MCP سرور کو پکارتا ہے تو سرور اسے اشارے دیتا ہے تاکہ وہ زیادہ سمجھ داری سے چلے:

### ask_peer خود بخود چلنے کے اشارے

```toml
[auto_consult.triggers]
keywords_match_authority = true        # کوڈ یا گفتگو میں peer.authority کے الفاظ آئیں
explicit_uncertainty     = true        # جب Claude Code کہے «I'm not sure»
import_vendor_lib        = true        # کسی فراہم کنندہ کا SDK درآمد کیا گیا
```

نفاذ کا طریقہ: MCP سرور اوزار کی تفصیل میں اشارہ جوڑ دیتا ہے — جیسے `ask_peer` کی تفصیل کے آخر میں:

> "Strongly prefer calling this over guessing for any question about: X100, X200, Modbus, RTU, TCP, PowerSupply-lib (from registered peers' authority lists)."

یہ اشارہ دیکھ کر Claude Code خود طے کرتا ہے کہ پکارنا ہے۔

### منصوبہ یادداشت کا خودکار لکھا جانا

ہر کامیاب `ask_peer` کے بعد MCP سرور جواب میں سے «حقائق» ساختہ صورت میں نکال کر `facts.md` میں لکھنے کی کوشش کرتا ہے:

```
[after ask_peer succeeds]
→ MCP server analyzes the answer
→ if it contains structured facts (numbers, addresses, codes), extract
→ append to .claude/peers/{peer_slug}/facts.md with citation
→ return enriched response to Claude Code
```

## شناخت کا آر پار جانا

A2A درخواست پر `via: claude-code` کا نشان ہوتا ہے:

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

سامنے والا Agent `context.via` دیکھ کر اپنے جواب کا انداز بدل سکتا ہے:

- `via: claude-code` → ساختہ جواب (کوڈ بلاک، JSON، واضح خانہ نام)
- `via: web` → فطری زبان میں جواب، زیادہ وضاحت اور سیاق کے ساتھ
- `via: mobile` → مختصر، اصل بات نمایاں، چھوٹی سکرین پر پڑھنے کے قابل

یہ اشارہ لازمی نہیں، سامنے والا Agent اسے نظرانداز کر سکتا ہے۔ مگر بہتر ہے سب اس کی پابندی کریں۔

## سلامتی اور بھروسہ

### اجازت کی تہہ

MCP سے Claude Code کا `ask_peer` پکارنا طے شدہ طور پر L1 ہے (صرف پڑھنے والا مشورہ)۔ جبکہ:

- `request_code_review` (peer کو کوڈ دینا) → L2، پہلی بار صارف سے پوچھا جاتا ہے
- `share_files` (فائلوں کی ڈائریکٹری بانٹنا) → L2
- `commit_on_behalf` (صارف کی جانب سے فیصلہ) → L3، ہر بار پوچھا جاتا ہے

اجازت کی درخواست MCP سرور مرکزی پروگرام کو بھیجتا ہے، مرکزی پروگرام IM کی سکرین پر اجازت کا کارڈ دکھاتا ہے، صارف فیصلہ کرتا ہے، اور نتیجہ Claude Code کے پاس لوٹ کر کام آگے بڑھتا ہے۔

### بھروسے کی تہہ

- `peer.{slug}.trust = "high"` ہونے پر اُس peer کا جواب، اس کے دائرۂ سند کے اندر، Claude Code کے عمومی علم پر بھاری پڑتا ہے
- `trust = "medium"` ہونے پر حوالہ بطور مرجع لیا جاتا ہے مگر Claude Code اسے نشان زد کر دیتا ہے
- `trust = "low"` ہو، یا peer نیا اور غیر تصدیق شدہ ہو، تو حوالہ شدہ نتیجے کی تصدیق ہمیشہ صارف سے مانگی جاتی ہے

### رفتار اور لاگت

MCP سرور کی مقامی شرحِ حد:

- ایک Claude Code session میں ایک ہی peer سے زیادہ سے زیادہ 50 بار `ask_peer`
- جمع شدہ حد پار ہونے پر «جاری رکھیں؟» کا اشارہ ابھرتا ہے
- ہر پکار کی متوقع لاگت دکھائی جاتی ہے (سامنے والے Agent کے ماڈل کی بنیاد پر)

## CLI احکام

ضمنی احکام، جنہیں صارف shell میں چلاتا ہے:

```bash
# درج شدہ peer کی فہرست
confer peer list

# peer شامل کریں
confer peer add abc-industries --did did:web:acme.com:agents:support
confer peer add abc-industries --domain acme.com    # well-known خود دیکھ لیتا ہے

# منصوبے کی یادداشت دیکھیں
confer memory show abc-industries
confer memory show abc-industries --section facts

# سیدھا کمانڈ لائن سے پوچھیں
confer ask abc-industries "RTU موڈ میں X100 کی وولٹیج کی حد کیا ہے؟"

# منصوبے کی یادداشت Confer کے سرور سے ملائیں
confer sync push
confer sync pull
```

## MCP سرور کے نفاذ کی اہم باتیں

تکنیکی ڈھانچہ:

- Bun + TypeScript
- `@modelcontextprotocol/sdk`
- مقامی SQLite کیش (تاکہ ہر بار سرور تک نہ جانا پڑے)
- ٹوکن Keychain / Credential Manager میں

اہم فائلیں:

```
packages/mcp-server/
├── src/
│   ├── index.ts              # MCP سرور کا مرکزی داخلی نقطہ
│   ├── tools/
│   │   ├── ask-peer.ts
│   │   ├── list-peers.ts
│   │   ├── discover-peer.ts
│   │   ├── project-memory.ts
│   │   ├── design-review.ts
│   │   └── code-review.ts
│   ├── resources/
│   ├── prompts/
│   ├── client.ts             # Confer API کلائنٹ
│   ├── auth.ts               # OAuth بہاؤ
│   ├── cache.ts              # مقامی SQLite کیش
│   └── config.ts             # .claude/confer.toml پڑھتا ہے
└── package.json
```

داخلی نقطے کی مثال:

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

## قبولیت کے معیار (v1)

- [ ] `claude mcp add confer` ایک سطر میں نصب کر دے
- [ ] پہلا آغاز OAuth کی پوری ترتیب کروا دے
- [ ] `ask_peer` سرے سے سرے تک 10 سیکنڈ سے کم لے (LLM کے سوچنے کا وقت ملا کر)
- [ ] `read_project_memory` 100 ملی سیکنڈ سے کم (مقامی کیش ملنے پر)
- [ ] pre-flight جائزے سے Claude Code اپنا منصوبہ درست کر لے
- [ ] git کمٹ کے بعد منصوبے کی یادداشت ریپازٹری کے ساتھ چلے
- [ ] کم از کم ایک عوامی فراہم کنندہ Agent دستیاب ہو (ڈیمو کے لیے: mock-vendor.confer.dev)

## نفاذ کی حالت (v0.1)

اوپر کا سب کچھ مکمل تصور ہے۔ زمین پر اترنے والا پہلا نسخہ `packages/mcp-a2a` «peer agent سے پوچھنے» کا مرکزی دائرہ مکمل کر چکا ہے:

**فن تعمیر (دو تہیں)**

- گیٹ وے میں صارف کی پہل پر باہر جانے والا A2A مشورہ شامل ہوا (`/api/v1/consult/*`، دیکھیں `docs/05-api.md`)۔ اس سے پہلے پلیٹ فارم پر A2A پیغام بھیجنے کا ایک ہی راستہ تھا — «اندر آنا ← خودکار جواب» — اور صارف کی پہل پر باہر جانے والا کوئی راستہ نہ تھا۔
- `packages/mcp-a2a`: stdio پر چلنے والا MCP سرور، جو **ایک ترتیب شدہ Confer صارف** کی شناخت سے گیٹ وے میں داخل ہو کر ٹوکن لیتا ہے اور مشورے کی صلاحیت کو اوزاروں کی صورت میں پیش کرتا ہے۔ دستخط اب بھی گیٹ وے ہی میں ہوتے ہیں؛ نجی کلید گیٹ وے سے باہر نہیں جاتی۔

**نافذ اوزار (15)**

| شعبہ | اوزار |
|----|------|
| دریافت | `list_agents` / `get_agent_capabilities` / `find_agents` |
| مشورہ | `ask_agent` (ہم وقت انتظار) / `follow_up` / `get_conversation` |
| اعلیٰ | `ask_multiple` (متوازی، زیادہ سے زیادہ 5) / `check_reply` (غیر ہم وقت وصولی) |
| نظم | `whoami` |
| مخصوص فرد | `ask_person_agent` (کسی خاص فرد کے agent سے پوچھنا؛ Wizard خانے بھر دیتا ہے) |
| منصوبہ یادداشت | `read_project_memory` (facts/decisions پڑھتا ہے؛ نہ ہونا خالی پن ہے، خرابی نہیں) / `write_project_memory` (facts یا decisions لکھتا ہے، ایک دوسرے کو مٹائے بغیر، `version` بڑھاتے ہوئے) |
| دریافت + جائزہ | `discover_peer` (domain/did/username سے peer دریافت کر کے محفوظ کرتا ہے اور `peer_id` لوٹاتا ہے؛ **رابطے کا تعلق نہیں بناتا** — پہلے مرکزی پروگرام میں اسے رابطے کے طور پر قبول کرنا ہو گا، ورنہ آگے کی یادداشت نویسی یا مشورہ `403` کھائے گا؛ یہی رضامندی کا دروازہ ہے) / `request_design_review` (peer سے منصوبے کا جائزہ مانگنا) / `request_code_review` (peer سے فائلوں کا جائزہ مانگنا) |

یادداشت والے اوزاروں کا `project` پیرامیٹر چھوڑا جا سکتا ہے؛ چھوڑنے پر MCP میں ترتیب شدہ `projectId` پر لوٹ آتا ہے (`CONFER_PROJECT_ID` ماحول متغیر، جس کی طے شدہ قدر کام کی ڈائریکٹری کا basename ہے)۔

**اتصال**

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
        // اختیاری: منصوبہ یادداشت کا دائرہ طے کرنے والی id، طے شدہ طور پر کام کی ڈائریکٹری کا نام
        "CONFER_PROJECT_ID": "${CONFER_PROJECT_ID}"
      }
    }
  }
}
```

**تصور سے فاصلہ (آگے کے لیے)**: OAuth کا ربط، vendor specialist کی دیرپا یادداشت اور `.claude/peers/` میں جمع، pre/post-flight جائزے اور سند کی ترجیح اب بھی backlog میں ہیں؛ آج شناخت ایک ہی ترتیب شدہ صارف کی ہے، جواب طویل انتظار سے آتے ہیں، اور زیرِ التوا اجازتیں فی الحال `pending` کے طور پر دکھائی جاتی ہیں۔
