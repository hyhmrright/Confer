# Confer — Claude Code का MCP प्लगिन डिज़ाइन

Confer को Claude Code का MCP सर्वर बना देना, ताकि कोड लिखते-लिखते Claude Code सीधे विक्रेता या भीतरी Agent से पूछ सके और उत्तर परियोजना में जमा हो जाएँ। **यही Confer की निर्णायक विशेषता है।**

## डिज़ाइन के सिद्धांत

बात «एक औज़ार टाँग देने» की नहीं है, बल्कि Claude Code को **क्षेत्र-विशेषज्ञों की एक टीम** देने की है। हर विक्रेता के लिए एक ऐसा «विशेषज्ञ» होता है जिसकी स्मृति टिकाऊ है, और ज्ञान परियोजना में जमा होता जाता है — session बदलने पर खोता नहीं।

डिज़ाइन के पाँच स्तंभ (रणनीतिक विवरण `docs/01-product.md` में):

1. Vendor specialist subagent — एक टिकाऊ क्षेत्र-विशेषज्ञ
2. परियोजना-स्तर पर ज्ञान का जमाव — `.claude/peers/`
3. Pre-flight design review — कोड लिखने से पहले विशेषज्ञ से गुज़ारना
4. Post-flight code review — लिखा हुआ कोड विशेषज्ञ से जँचवाना
5. अधिकार की प्राथमिकता + पहचान की पारदर्शिता — अपने क्षेत्र में विक्रेता का निर्णय सामान्य LLM पर भारी पड़ता है

## स्थापना

> नीचे दिया `claude mcp add … @confer/mcp-server` और OAuth **लक्ष्य-दृष्टि** है। v0.1 की असली स्थापना इस खंड के अंत में «वर्तमान कार्यान्वयन (v0.1)» में है — आज जो मौजूद है वह पर्यावरण-चर से प्रमाणीकरण करने वाला `confer-a2a` प्लगिन है।

```bash
# उपयोगकर्ता की दृष्टि से (लक्ष्य)
claude mcp add confer npx -y @confer/mcp-server

# पहली बार चलने पर OAuth से Confer खाता जोड़ने की राह दिखाता है
claude mcp config confer
# इंस्टेंस चुनें: cloud.confer.ai या अपने इंस्टेंस का URL
# OAuth प्रमाणीकरण के लिए ब्राउज़र पर ले जाता है
```

विन्यास फ़ाइल (उपयोगकर्ता संपादित करता है):

```toml
# .claude/confer.toml

[instance]
url    = "https://cloud.confer.ai"
token  = "encrypted-by-keychain"

[defaults]
auto_consult = true               # कीवर्ड मिलते ही अपने-आप पूछ लेना
review_mode  = "post-flight"      # never | pre-flight | post-flight | both
language     = "hi"

[peer.abc-industries]
did       = "did:web:acme.com:agents:support"
authority = ["X100", "X200", "Modbus", "RTU", "TCP"]
trust     = "high"

[peer.internal-sdk]
did       = "did:web:mycompany.com:agents:sdk-team"
authority = ["powersupply-lib", "internal-bus", "auth-service"]
trust     = "high"
```

### वर्तमान कार्यान्वयन (v0.1)

लक्ष्य-दृष्टि वाला OAuth और npx पैकेज अभी नहीं बना। जो बन चुका है वह है **प्लगिन marketplace से एक-क्लिक स्थापना**, जिसमें प्रमाणीकरण पर्यावरण-चर से होता है (हस्ताक्षर की निजी कुंजी हमेशा गेटवे में ही रहती है, नीचे नहीं उतरती):

```bash
# 1. marketplace जोड़ें और प्लगिन स्थापित करें (यह रिपॉज़िटरी ही marketplace है)
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer

# 2. shell में खाता निर्यात करें (प्लगिन इसे पर्यावरण से पढ़ता है; प्रमाण-पत्र रिपॉज़िटरी में नहीं लिखे जाते)
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
# वैकल्पिक: export CONFER_GATEWAY_URL=http://localhost:3000  (डिफ़ॉल्ट मान)
```

प्लगिन अपने साथ एक स्वयंपूर्ण bundle लाता है (`plugins/confer-a2a/dist/server.mjs`, जो नंगे `node` से चल जाता है — न monorepo चाहिए, न `bun`), जो `packages/mcp-a2a` से `bun run --filter @confer/mcp-a2a build:plugin` द्वारा बनता है। यह 15 औज़ार देता है (`list_agents` / `ask_agent` / `follow_up` / `ask_multiple` / `check_reply` आदि); विवरण `plugins/confer-a2a/README.md` और `packages/mcp-a2a/README.md` में।

जो रिपॉज़िटरी के भीतर विकास करते हैं वे प्लगिन के बिना भी काम चला सकते हैं — सीधे जड़ की `.mcp.json` (जो स्रोत के `server.ts` की ओर इशारा करती है) या `claude mcp add` से।

## उजागर किए गए MCP औज़ार

### `ask_peer`

किसी peer Agent से प्रश्न पूछना।

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

लौटाता है:

```json
{
  "answer": "0x03, Read Holding Registers से…",
  "citations": [{"source": "X100 संचार पुस्तिका v3.2", "page": 87}],
  "thread_id": "thread_8f3a9c",
  "peer_did": "did:web:acme.com:agents:support",
  "latency_ms": 4231
}
```

### `list_peers`

अभी उपलब्ध peer Agent की सूची।

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

नया peer Agent खोजना (डोमेन से तलाश)।

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

इस परियोजना में जमा ज्ञान पढ़ना।

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

परियोजना का ज्ञान लिखना (आम तौर पर ask_peer के बाद अपने-आप बुलाया जाता है, हाथ से भी हो सकता है)।

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

Pre-flight: डिज़ाइन की योजना विशेषज्ञ से गुज़ारना।

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

Post-flight: लिखे हुए कोड को विशेषज्ञ से जँचवाना।

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

## उजागर किए गए MCP resources

Claude Code इन्हें `@resource:…` वाक्य-रचना से संदर्भित कर सकता है।

### `confer://peers/{peer_slug}/facts`

markdown रूप में facts फ़ाइल लौटाता है।

### `confer://peers/{peer_slug}/conversations/{thread_id}`

किसी एक बातचीत का पूरा अभिलेख लौटाता है।

### `confer://threads/{thread_id}`

मुख्य प्रोग्राम के IM की किसी बातचीत को संदर्भ के रूप में लौटाता है (उपयोगकर्ता IM में thread का URL कॉपी करके Claude Code को दे सकता है)।

## उजागर किए गए MCP prompts

पहले से बने prompt टेम्पलेट, जिन्हें उपयोगकर्ता झट से चला सकता है।

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

## स्वायत्त निर्णय-व्यवहार

Claude Code जब Confer के MCP सर्वर को बुलाता है, तो सर्वर उसे संकेत देता है ताकि वह अधिक समझदारी से बरते:

### ask_peer अपने-आप चलने के संकेत

```toml
[auto_consult.triggers]
keywords_match_authority = true        # कोड या बातचीत में peer.authority के शब्द आए
explicit_uncertainty     = true        # जब Claude Code कहे «I'm not sure»
import_vendor_lib        = true        # किसी विक्रेता का SDK आयात किया गया
```

कार्यान्वयन का तरीक़ा: MCP सर्वर औज़ार के विवरण में संकेत जोड़ देता है — जैसे `ask_peer` के विवरण के अंत में:

> "Strongly prefer calling this over guessing for any question about: X100, X200, Modbus, RTU, TCP, PowerSupply-lib (from registered peers' authority lists)."

यह संकेत देखकर Claude Code स्वयं तय करता है कि बुलाना है।

### परियोजना स्मृति का स्वतः लेखन

हर सफल `ask_peer` के बाद MCP सर्वर उत्तर में से «तथ्य» संरचित रूप में निकालने और `facts.md` में लिखने की कोशिश करता है:

```
[after ask_peer succeeds]
→ MCP server analyzes the answer
→ if it contains structured facts (numbers, addresses, codes), extract
→ append to .claude/peers/{peer_slug}/facts.md with citation
→ return enriched response to Claude Code
```

## पहचान का आर-पार जाना

A2A अनुरोध पर `via: claude-code` का लेबल रहता है:

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

सामने वाला Agent `context.via` देखकर अपने उत्तर की शैली बदल सकता है:

- `via: claude-code` → संरचित उत्तर (कोड ब्लॉक, JSON, स्पष्ट फ़ील्ड-नाम)
- `via: web` → प्राकृतिक भाषा में उत्तर, अधिक व्याख्या और संदर्भ के साथ
- `via: mobile` → संक्षिप्त, मुख्य बात उभरी हुई, छोटी स्क्रीन पर पढ़ने लायक़

यह संकेत बाध्यकारी नहीं है, सामने वाला Agent इसे अनदेखा कर सकता है। पर सुझाव है कि सब इसका पालन करें।

## सुरक्षा और भरोसा

### अनुमति की परत

MCP से Claude Code का `ask_peer` बुलाना डिफ़ॉल्ट रूप से L1 है (केवल पढ़ने वाली सलाह)। जबकि:

- `request_code_review` (peer को कोड देना) → L2, पहली बार उपयोगकर्ता से पूछा जाता है
- `share_files` (फ़ाइल निर्देशिका साझा करना) → L2
- `commit_on_behalf` (उपयोगकर्ता की ओर से निर्णय) → L3, हर बार पूछा जाता है

अनुमति का अनुरोध MCP सर्वर मुख्य प्रोग्राम को अग्रेषित करता है, मुख्य प्रोग्राम IM के परदे पर अनुमति-कार्ड दिखाता है, उपयोगकर्ता निर्णय लेता है, और परिणाम Claude Code के पास लौटकर काम आगे बढ़ता है।

### भरोसे की परत

- `peer.{slug}.trust = "high"` होने पर उस peer का उत्तर, उसके अधिकार-क्षेत्र के भीतर, Claude Code के सामान्य ज्ञान पर भारी पड़ता है
- `trust = "medium"` होने पर उद्धरण संदर्भ के रूप में लिया जाता है पर Claude Code उसे चिह्नित करता है
- `trust = "low"` हो, या peer नया और अपुष्ट हो, तो उद्धृत परिणाम की पुष्टि हमेशा उपयोगकर्ता से माँगी जाती है

### गति और लागत

MCP सर्वर की स्थानीय दर-सीमा:

- एक Claude Code session में एक ही peer से अधिकतम 50 बार `ask_peer`
- संचित सीमा पार होने पर «जारी रखें?» का संकेत उभरता है
- हर कॉल की अनुमानित लागत दिखाई जाती है (सामने वाले Agent के मॉडल के आधार पर)

## CLI आदेश

पूरक आदेश, जिन्हें उपयोगकर्ता shell में चलाता है:

```bash
# पंजीकृत peer की सूची
confer peer list

# peer जोड़ें
confer peer add abc-industries --did did:web:acme.com:agents:support
confer peer add abc-industries --domain acme.com    # well-known अपने-आप देख लेता है

# परियोजना की स्मृति देखें
confer memory show abc-industries
confer memory show abc-industries --section facts

# सीधे कमांड लाइन से पूछें
confer ask abc-industries "RTU मोड में X100 की वोल्टेज सीमा क्या है?"

# परियोजना की स्मृति Confer के सर्वर से मिलाएँ
confer sync push
confer sync pull
```

## MCP सर्वर के कार्यान्वयन की मुख्य बातें

तकनीकी ढाँचा:

- Bun + TypeScript
- `@modelcontextprotocol/sdk`
- स्थानीय SQLite कैश (ताकि हर बार सर्वर तक न जाना पड़े)
- टोकन Keychain / Credential Manager में

मुख्य फ़ाइलें:

```
packages/mcp-server/
├── src/
│   ├── index.ts              # MCP सर्वर का मुख्य प्रवेश-बिंदु
│   ├── tools/
│   │   ├── ask-peer.ts
│   │   ├── list-peers.ts
│   │   ├── discover-peer.ts
│   │   ├── project-memory.ts
│   │   ├── design-review.ts
│   │   └── code-review.ts
│   ├── resources/
│   ├── prompts/
│   ├── client.ts             # Confer API क्लाइंट
│   ├── auth.ts               # OAuth प्रवाह
│   ├── cache.ts              # स्थानीय SQLite कैश
│   └── config.ts             # .claude/confer.toml पढ़ता है
└── package.json
```

प्रवेश-बिंदु का उदाहरण:

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

## स्वीकृति की कसौटी (v1)

- [ ] `claude mcp add confer` एक पंक्ति में स्थापित कर दे
- [ ] पहला आरंभ OAuth का पूरा विन्यास करा दे
- [ ] `ask_peer` आरंभ से अंत तक 10 सेकंड से कम ले (LLM के सोचने का समय मिलाकर)
- [ ] `read_project_memory` 100 मिलीसेकंड से कम (स्थानीय कैश मिलने पर)
- [ ] pre-flight समीक्षा से Claude Code अपनी योजना सुधार ले
- [ ] git कमिट के बाद परियोजना की स्मृति रिपॉज़िटरी के साथ चले
- [ ] कम से कम एक सार्वजनिक विक्रेता Agent उपलब्ध हो (डेमो के लिए: mock-vendor.confer.dev)

## कार्यान्वयन की स्थिति (v0.1)

ऊपर का सब पूरी दृष्टि है। ज़मीन पर उतरा पहला संस्करण `packages/mcp-a2a` «peer agent से पूछने» वाला केंद्रीय चक्र पूरा कर चुका है:

**वास्तुकला (दो परतें)**

- गेटवे में उपयोगकर्ता की पहल पर बाहर जाती A2A सलाह जुड़ी (`/api/v1/consult/*`, देखें `docs/05-api.md`)। इससे पहले प्लेटफ़ॉर्म पर A2A संदेश भेजने का एक ही रास्ता था — «भीतर आना → स्वतः उत्तर» — और उपयोगकर्ता की पहल पर बाहर जाने वाला कोई मार्ग नहीं था।
- `packages/mcp-a2a`: stdio पर चलने वाला MCP सर्वर, जो **एक विन्यस्त Confer उपयोगकर्ता** की पहचान से गेटवे में लॉगिन कर टोकन लेता है और सलाह की क्षमता को औज़ारों के रूप में उजागर करता है। हस्ताक्षर अब भी गेटवे में ही होते हैं; निजी कुंजी गेटवे से बाहर नहीं जाती।

**लागू औज़ार (15)**

| क्षेत्र | औज़ार |
|----|------|
| खोज | `list_agents` / `get_agent_capabilities` / `find_agents` |
| सलाह | `ask_agent` (समकालिक प्रतीक्षा) / `follow_up` / `get_conversation` |
| उन्नत | `ask_multiple` (समानांतर, अधिकतम 5) / `check_reply` (अतुल्यकालिक रूप से लेना) |
| संचालन | `whoami` |
| निर्दिष्ट व्यक्ति | `ask_person_agent` (किसी ख़ास व्यक्ति के agent से पूछना; Wizard भर देता है) |
| परियोजना स्मृति | `read_project_memory` (facts/decisions पढ़ता है; न होना ख़ालीपन है, त्रुटि नहीं) / `write_project_memory` (facts या decisions लिखता है, एक दूसरे को मिटाए बिना, `version` बढ़ाते हुए) |
| खोज + समीक्षा | `discover_peer` (domain/did/username से peer खोजकर संचित करता है और `peer_id` लौटाता है; **संपर्क का रिश्ता नहीं बनाता** — पहले मुख्य प्रोग्राम में उसे संपर्क के रूप में स्वीकारना होगा, वरना आगे की स्मृति-लेखन या सलाह `403` खाएगी; यही सहमति का द्वार है) / `request_design_review` (peer से योजना की समीक्षा माँगना) / `request_code_review` (peer से फ़ाइलों की समीक्षा माँगना) |

स्मृति वाले औज़ारों का `project` पैरामीटर छोड़ा जा सकता है; छोड़ने पर MCP में विन्यस्त `projectId` पर लौट आता है (`CONFER_PROJECT_ID` पर्यावरण-चर, जिसका डिफ़ॉल्ट कार्य-निर्देशिका का basename है)।

**संयोजन**

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
        // वैकल्पिक: परियोजना स्मृति का दायरा तय करने वाली id, डिफ़ॉल्ट में कार्य-निर्देशिका का नाम
        "CONFER_PROJECT_ID": "${CONFER_PROJECT_ID}"
      }
    }
  }
}
```

**दृष्टि से दूरी (आगे के लिए)**: OAuth बंधन, vendor specialist की टिकाऊ स्मृति और `.claude/peers/` में जमाव, pre/post-flight समीक्षा तथा अधिकार-प्राथमिकता अब भी backlog में हैं; आज पहचान एक ही विन्यस्त उपयोगकर्ता की है, उत्तर लंबी प्रतीक्षा से आते हैं, और लंबित अनुमतियाँ फ़िलहाल `pending` के रूप में दिखती हैं।
