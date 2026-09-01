# Confer — تصميم إضافة MCP لـ Claude Code

جعل Confer خادوم MCP لـ Claude Code، حتى يستطيع Claude Code وهو يكتب الشيفرة أن يستشير مباشرةً وكلاء المورّدين أو الوكلاء الداخليين، وتترسّب الأجوبة في المشروع. **وهذه هي الميزة الحاسمة في Confer.**

## مبادئ التصميم

ليست المسألة «تعليق أداة»، بل منح Claude Code **فريقًا من خبراء المجال**. فلكل مورّد «خبير» ذو ذاكرة معمّرة، والمعرفة تترسّب في المشروع ولا تضيع بين جلسة وأخرى.

خمسة أعمدة للتصميم (التفصيل الاستراتيجي في `docs/01-product.md`):

1. Vendor specialist subagent — خبير مجال دائم
2. ترسيب المعرفة على مستوى المشروع — `.claude/peers/`
3. Pre-flight design review — المرور على الخبير قبل كتابة الشيفرة
4. Post-flight code review — عرض الشيفرة المكتوبة على الخبير
5. أولوية المرجعية وشفافية الهوية — حكم المورّد في مجاله يرجّح على حكم النموذج العام

## التنصيب

> ما تراه أدناه من `claude mcp add … @confer/mcp-server` مع OAuth هو **التصوّر المنشود**. أما التنصيب الفعلي للإصدار v0.1 ففي آخر هذا القسم تحت «التنفيذ الحالي (v0.1)»: الموجود اليوم هو إضافة `confer-a2a` التي توثِّق عبر متغيّرات البيئة.

```bash
# من زاوية المستخدم (التصوّر)
claude mcp add confer npx -y @confer/mcp-server

# عند أول تشغيل يقود عملية OAuth لربط حساب Confer
claude mcp config confer
# اختر النسخة: cloud.confer.ai أو عنوان نسختك
# ينتقل OAuth إلى المتصفّح للتوثيق
```

ملف الإعدادات (يحرّره المستخدم):

```toml
# .claude/confer.toml

[instance]
url    = "https://cloud.confer.ai"
token  = "encrypted-by-keychain"

[defaults]
auto_consult = true               # الاستشارة تلقائيًا عند رصد كلمات مفتاحية
review_mode  = "post-flight"      # never | pre-flight | post-flight | both
language     = "ar"

[peer.abc-industries]
did       = "did:web:acme.com:agents:support"
authority = ["X100", "X200", "Modbus", "RTU", "TCP"]
trust     = "high"

[peer.internal-sdk]
did       = "did:web:mycompany.com:agents:sdk-team"
authority = ["powersupply-lib", "internal-bus", "auth-service"]
trust     = "high"
```

### التنفيذ الحالي (v0.1)

لم يُنجَز بعدُ ما في التصوّر من OAuth وحزمة npx. المُنجَز هو **التنصيب بنقرة واحدة من سوق الإضافات**، والتوثيق بمتغيّرات البيئة (ومفتاح التوقيع الخاص يبقى دائمًا في البوابة ولا ينزل):

```bash
# 1. أضف السوق ونصّب الإضافة (هذا المستودع هو السوق نفسه)
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer

# 2. صدّر الحساب في الصدفة (تقرأه الإضافة من البيئة، ولا تُكتب بيانات الاعتماد في المستودع)
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
# اختياري: export CONFER_GATEWAY_URL=http://localhost:3000  (القيمة الافتراضية)
```

تحمل الإضافة حزمة مكتفية بذاتها (`plugins/confer-a2a/dist/server.mjs`، تعمل بـ`node` مجرّدًا، بلا حاجة إلى المستودع الموحّد ولا إلى `bun`)، تُولَّد من `packages/mcp-a2a` بالأمر `bun run --filter @confer/mcp-a2a build:plugin`. وهي تقدّم 15 أداة (`list_agents` و`ask_agent` و`follow_up` و`ask_multiple` و`check_reply` وغيرها)؛ والتفصيل في `plugins/confer-a2a/README.md` و`packages/mcp-a2a/README.md`.

ومن يطوّر داخل المستودع يمكنه الاستغناء عن الإضافة واستعمال `.mcp.json` في الجذر مباشرةً (وهو يشير إلى `server.ts` في المصدر) أو `claude mcp add`.

## أدوات MCP المتاحة

### `ask_peer`

طرح سؤال على وكيل قرين.

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

تعيد:

```json
{
  "answer": "بالرمز 0x03، أي Read Holding Registers…",
  "citations": [{"source": "دليل اتصالات X100 الإصدار 3.2", "page": 87}],
  "thread_id": "thread_8f3a9c",
  "peer_did": "did:web:acme.com:agents:support",
  "latency_ms": 4231
}
```

### `list_peers`

سرد الوكلاء الأقران المتاحين الآن.

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

اكتشاف وكيل قرين جديد (بحث بالنطاق).

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

قراءة المعرفة المترسّبة في هذا المشروع.

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

كتابة معرفة المشروع (تُستدعى تلقائيًا بعد ask_peer عادةً، ويمكن استدعاؤها يدويًا).

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

Pre-flight: عرض خطة التصميم على الخبير.

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

Post-flight: عرض الشيفرة المكتوبة على الخبير لمراجعتها.

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

## موارد MCP المتاحة

يستطيع Claude Code الإشارة إليها بصيغة `@resource:…`.

### `confer://peers/{peer_slug}/facts`

تعيد ملف facts بصيغة markdown.

### `confer://peers/{peer_slug}/conversations/{thread_id}`

تعيد السجلّ الكامل لمحادثة بعينها.

### `confer://threads/{thread_id}`

تعيد إحدى محادثات المراسلة في البرنامج الرئيس بوصفها سياقًا (يمكن للمستخدم أن ينسخ عنوان الخيط من المراسلة ويعطيه لـ Claude Code).

## موجّهات MCP المتاحة

قوالب موجّهات جاهزة يستطيع المستخدم إطلاقها بسرعة.

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

## سلوك القرار الذاتي

حين يستدعي Claude Code خادوم MCP الخاص بـ Confer، يعطيه الخادوم تلميحات ليتصرّف بذكاء أكبر:

### الإشارات التي تُطلق ask_peer تلقائيًا

```toml
[auto_consult.triggers]
keywords_match_authority = true        # ظهور كلمات من peer.authority في الشيفرة أو المحادثة
explicit_uncertainty     = true        # حين يقول Claude Code «I'm not sure»
import_vendor_lib        = true        # جرى استيراد حزمة تطوير خاصة بمورّد ما
```

طريقة التنفيذ: يضيف خادوم MCP التلميح داخل وصف الأداة، كأن يُلحق بآخر وصف `ask_peer`:

> "Strongly prefer calling this over guessing for any question about: X100, X200, Modbus, RTU, TCP, PowerSupply-lib (from registered peers' authority lists)."

يرى Claude Code هذا التلميح فيقرّر بنفسه أن يستدعي الأداة.

### الكتابة التلقائية لذاكرة المشروع

بعد كل نجاح لـ`ask_peer`، يحاول خادوم MCP أن يستخرج «الوقائع» من الجواب استخراجًا مبنيًا ويكتبها في `facts.md`:

```
[after ask_peer succeeds]
→ MCP server analyzes the answer
→ if it contains structured facts (numbers, addresses, codes), extract
→ append to .claude/peers/{peer_slug}/facts.md with citation
→ return enriched response to Claude Code
```

## نفاذ الهوية

يحمل طلب A2A وسم `via: claude-code`:

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

ويستطيع الوكيل المقابل أن يضبط أسلوب جوابه بحسب `context.via`:

- `via: claude-code` → جواب مبنيّ (كتل شيفرة، JSON، أسماء حقول واضحة)
- `via: web` → جواب بلغة طبيعية، مع شرح وسياق أوفر
- `via: mobile` → موجز، بارز النقاط، يسهل قراءته على شاشة صغيرة

وهذا التلميح غير مُلزِم، وللوكيل المقابل أن يتجاهله. لكنّ الأفضل أن يلتزم به الجميع.

## الأمن والثقة

### طبقة الأذونات

استدعاء Claude Code لـ`ask_peer` عبر MCP هو L1 افتراضيًا (استشارة للقراءة فقط). أما:

- `request_code_review` (مشاركة الشيفرة مع القرين) → L2، ويُسأل المستخدم في المرة الأولى
- `share_files` (مشاركة دليل ملفات) → L2
- `commit_on_behalf` (اتخاذ القرار نيابةً عن المستخدم) → L3، ويُسأل في كل مرة

يمرّر خادوم MCP طلب الإذن إلى البرنامج الرئيس، فيعرض البرنامج بطاقة إذن في واجهة المراسلة، ويقرّر المستخدم، ثم تعود النتيجة إلى Claude Code فيتابع عمله.

### طبقة الثقة

- عند `peer.{slug}.trust = "high"` يرجّح جواب ذلك القرين، داخل نطاق مرجعيته، على المعرفة العامة لدى Claude Code
- وعند `trust = "medium"` يُؤخذ الاقتباس للاستئناس، ويشير إليه Claude Code بذلك
- وعند `trust = "low"`، أو مع قرين مضاف حديثًا لم يُتحقّق منه، يُطلب من المستخدم دائمًا أن يؤكّد النتيجة المقتبَسة

### المعدّل والكلفة

تحديد معدّل محلي في خادوم MCP:

- خمسون استدعاءً لـ`ask_peer` إلى القرين الواحد على الأكثر داخل جلسة Claude Code واحدة
- عند تجاوز الحدّ التراكمي يظهر سؤال «هل نتابع؟»
- تُعرض الكلفة التقديرية لكل استدعاء (بحسب النموذج الذي يستعمله الوكيل المقابل)

## أوامر سطر الأوامر

أوامر مساعدة يستعملها المستخدم في الصدفة:

```bash
# سرد الأقران المسجّلين
confer peer list

# إضافة قرين
confer peer add abc-industries --did did:web:acme.com:agents:support
confer peer add abc-industries --domain acme.com    # يستعلم من well-known تلقائيًا

# الاطلاع على ذاكرة المشروع
confer memory show abc-industries
confer memory show abc-industries --section facts

# السؤال مباشرةً من سطر الأوامر
confer ask abc-industries "ما مدى الجهد لجهاز X100 في نمط RTU؟"

# مزامنة ذاكرة المشروع مع خادوم Confer
confer sync push
confer sync pull
```

## نقاط تنفيذ خادوم MCP

حزمة التقنيات:

- Bun + TypeScript
- `@modelcontextprotocol/sdk`
- ذاكرة تخزين محلية بـSQLite (لتفادي مراجعة الخادوم في كل مرة)
- يُحفظ الرمز في Keychain / Credential Manager

الملفات الرئيسة:

```
packages/mcp-server/
├── src/
│   ├── index.ts              # مدخل خادوم MCP
│   ├── tools/
│   │   ├── ask-peer.ts
│   │   ├── list-peers.ts
│   │   ├── discover-peer.ts
│   │   ├── project-memory.ts
│   │   ├── design-review.ts
│   │   └── code-review.ts
│   ├── resources/
│   ├── prompts/
│   ├── client.ts             # عميل واجهة Confer
│   ├── auth.ts               # تدفّق OAuth
│   ├── cache.ts              # ذاكرة تخزين محلية بـSQLite
│   └── config.ts             # يقرأ .claude/confer.toml
└── package.json
```

مثال على المدخل:

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

## معايير القبول (الإصدار v1)

- [ ] `claude mcp add confer` ينصّب بسطر واحد
- [ ] أول تشغيل يقود إعداد OAuth إلى تمامه
- [ ] `ask_peer` يتمّ في أقلّ من عشر ثوانٍ من طرف إلى طرف (بما فيها زمن تفكير النموذج)
- [ ] `read_project_memory` في أقلّ من مئة جزء من الألف من الثانية (عند إصابة الذاكرة المحلية)
- [ ] مراجعة ما قبل التنفيذ تدفع Claude Code إلى تصحيح خطته
- [ ] ذاكرة المشروع تسافر مع المستودع بعد إيداع git
- [ ] توفّر وكيل مورّد علني واحد على الأقل (للعرض التوضيحي: mock-vendor.confer.dev)

## حال التنفيذ (v0.1)

كل ما سبق هو التصوّر الكامل. أما أول إصدار نزل إلى أرض الواقع، `packages/mcp-a2a`، فقد أغلق الحلقة الأساسية: «استشارة وكيل قرين».

**البنية (طبقتان)**

- اكتسبت البوابة قدرة الاستشارة الصادرة عبر A2A بمبادرة المستخدم (`/api/v1/consult/*`، انظر `docs/05-api.md`). قبل ذلك لم يكن في المنصّة إلا مسار واحد لإرسال رسائل A2A — «وارد ← ردّ تلقائي» — ولا مسار صادر يبدؤه المستخدم البتة.
- `packages/mcp-a2a`: خادوم MCP يعمل على stdio، يدخل إلى البوابة بهوية **مستخدم Confer واحد مضبوط** ليأخذ رمزًا، ويعرض قدرة الاستشارة في صورة أدوات. ويبقى التوقيع في البوابة، والمفتاح الخاص لا يغادرها.

**الأدوات المنجَزة (15)**

| المجال | الأدوات |
|----|------|
| الاكتشاف | `list_agents` / `get_agent_capabilities` / `find_agents` |
| الاستشارة | `ask_agent` (انتظار متزامن) / `follow_up` / `get_conversation` |
| المتقدّم | `ask_multiple` (بالتوازي، خمسة على الأكثر) / `check_reply` (الاستلام اللامتزامن) |
| التشغيل | `whoami` |
| شخص بعينه | `ask_person_agent` (سؤال وكيل شخص محدّد، ويملأ المعالج البيانات) |
| ذاكرة المشروع | `read_project_memory` (يقرأ facts/decisions، وغيابها فراغ لا خطأ) / `write_project_memory` (يكتب facts أو decisions من غير أن يمحو أحدهما الآخر، مع زيادة `version`) |
| الاكتشاف والمراجعة | `discover_peer` (يكتشف قرينًا بـdomain أو did أو اسم مستخدم، ويقيّده، ويعيد `peer_id`؛ **ولا ينشئ علاقة جهة اتصال** — إذ لا بدّ من قبوله أولًا جهةَ اتصال في البرنامج الرئيس، وإلا فكل كتابة ذاكرة أو استشارة لاحقة تصطدم بـ`403`، وهذه هي بوابة الإذن) / `request_design_review` (طلب مراجعة خطة من القرين) / `request_code_review` (طلب مراجعة ملفات من القرين) |

ويمكن حذف معامل `project` في أدوات الذاكرة؛ وعند حذفه يُرجَع إلى `projectId` المضبوط في MCP (متغيّر البيئة `CONFER_PROJECT_ID`، وقيمته الافتراضية اسم دليل العمل).

**الاتصال**

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
        // اختياري: المعرّف الذي يحدّد نطاق ذاكرة المشروع، وافتراضه اسم دليل العمل
        "CONFER_PROJECT_ID": "${CONFER_PROJECT_ID}"
      }
    }
  }
}
```

**المسافة عن التصوّر (لاحقًا)**: الربط بـOAuth، والذاكرة المعمّرة لخبير المورّد والترسيب في `.claude/peers/`، ومراجعات ما قبل التنفيذ وما بعده، وأولوية المرجعية — كلها ما تزال في قائمة الأعمال المؤجَّلة. والهوية اليوم هوية مستخدم واحد مضبوط، والردود تصل باستطلاع طويل، والأذونات المعلّقة تُعرَض في الوقت الحالي بحالة `pending`.
