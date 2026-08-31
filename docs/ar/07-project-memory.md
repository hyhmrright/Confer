# Confer — ذاكرة المشروع (.claude/peers/)

يحدّد صيغة الملفات التي تترسّب بها المعرفة داخل المشروع في ظلّ التكامل مع Claude Code. وهذا من الابتكارات الجوهرية في Confer: **أن تسافر معرفة المورّد مع المشروع فلا تضيع بين جلسة وأخرى، ولا بين مطوّر وآخر، ولا بين جهاز وآخر**.

## بنية الأدلة

في جذر كل مشروع:

```
.claude/
├── confer.toml                   # إعدادات المشروع (الأقران ومستويات الثقة)
└── peers/
    ├── abc-industries/
    │   ├── facts.md              # وقائع موثّقة، مبنيّة
    │   ├── decisions.md          # سجلّ قرارات التصميم
    │   ├── conversations/        # تاريخ المحادثات كاملًا
    │   │   ├── 2024-11-15-modbus-setup.md
    │   │   └── 2024-11-20-temp-calibration.md
    │   ├── snippets/             # مقتطفات الشيفرة
    │   │   └── read_temp.py
    │   └── meta.json             # بيانات القرين الوصفية
    └── internal-sdk/
        ├── facts.md
        └── ...
```

يسافر مع git، ويتشاركه كل المتعاونين.

## صيغة الملفات

### `meta.json`

```json
{
  "peer": {
    "slug": "abc-industries",
    "did":  "did:web:acme.com:agents:support",
    "name": "ABC Industries Support",
    "endpoint": "https://acme.com/a2a/v1",
    "authority": ["X100", "X200", "Modbus", "RTU", "TCP"],
    "languages": ["en", "zh", "de"]
  },
  "trust": "high",
  "registered_at": "2024-11-01T10:00:00Z",
  "last_synced_at": "2024-11-15T14:30:00Z",
  "stats": {
    "total_queries": 47,
    "total_facts": 23,
    "total_decisions": 6
  }
}
```

### `facts.md`

قائمة وقائع مبنيّة. **ولا بدّ لكل واقعة من استشهاد**؛ فـ«الواقعة» بلا استشهاد هلوسة.

```markdown
# ABC Industries facts (project: modbus-integration)

> Auto-maintained by Confer. Each entry is verified by ABC Industries Agent
> with primary source citation. Do not edit machine-generated entries directly;
> use `confer memory edit` to propose changes.

## Modbus register map (X100)

- `0x40-0x47`: Temperature, 4 channels, units of 0.1°C, int16 signed
- `0x48-0x4F`: Pressure, 4 channels, units of 0.01 MPa, uint16
- `0x50-0x57`: Reserved (do not write)
- Function code: **0x03** (Read Holding Registers) — recommended
- Byte order: big-endian (high byte first)
- Default slave ID: **0x0A (10)** — not 1 as docs imply
  - Source: دليل اتصالات X100 الإصدار 3.2 p.87
  - Source: دليل تركيب X100 p.12 (slave ID note)
  - Verified: 2024-11-15 via ask_peer

## Wiring (X100)

- Power: 24V DC ± 10%, max 500mA
- RS-485 termination: 120Ω at both ends
- Cable length max: 1200m at 9600 baud, 500m at 115200 baud
  - Source: كتيّب تركيب X100 الإصدار 3.2 p.45
  - Verified: 2024-11-15

## RTU mode timing

- Inter-character timeout: ≥ 1.5 character times
- Inter-frame timeout: ≥ 3.5 character times
- Recommended polling interval: 200ms or more
  - Source: دليل اتصالات X100 الإصدار 3.2 p.103
  - Note: 100ms works but no CRC retry budget left
  - Verified: 2024-11-15
```

اصطلاحات الصيغة:

- تُفصَل الموضوعات بعناوين markdown من المستوى الثاني (`##`)
- كل واقعة عنصر في قائمة
- تُبرَز القيم المفتاحية بخط `**عريض**`
- في آخر كل مجموعة وقائع يلزم سطر `Source:` وطابع `Verified:`
- وتُكتب المصادر المتعدّدة في أسطر `Source:` متعدّدة

### `decisions.md`

قرارات التصميم التي اتُّخذت في المشروع وتتصل بهذا القرين. وهي تختلف عن facts (وهي خلاصات مرجعها المورّد)؛ فالـdecisions اختياراتنا نحن.

```markdown
# Decisions (project: modbus-integration, peer: abc-industries)

## D1: Use async polling at 200ms

**Date**: 2024-11-15
**Made by**: laowang (with consultation from ABC Agent)
**Status**: Active

We poll the X100 temperature/pressure registers every 200ms using async I/O.

**Alternatives considered:**
- 100ms polling — rejected: insufficient CRC retry budget
- Event-driven (X100 push) — not supported by this firmware

**Why this works for us**: 200ms latency is acceptable for our control loop;
async I/O lets us poll multiple devices concurrently.

**References:**
- See facts: "RTU mode timing"
- Conversation: 2024-11-15-modbus-setup.md
- Code: src/modbus/x100_client.py

---

## D2: Treat slave ID 10 as default; require explicit override

**Date**: 2024-11-15
**Made by**: laowang
**Status**: Active

After verification with ABC Agent that the documented "slave ID 1" is wrong
and actual default is 10, we hardcoded `DEFAULT_SLAVE_ID = 10` and require
explicit override via env variable for non-default installations.

**Why**: The vendor's docs and reality diverge. We trust verified vendor
statements over published docs.

**References:**
- See facts: "Modbus register map (X100)" → slave ID note
```

اصطلاحات الصيغة:

- لكل قرار معرّف فريد (`D1` و`D2` …)
- الحقول الإلزامية: Date وMade by وStatus
- Status: `Active` | `Superseded by D{n}` | `Deprecated`
- ويلزم سرد البدائل التي جرى النظر فيها
- ويلزم الربط رجوعًا إلى ما يخصّه من facts ومن شيفرة

### `conversations/{date}-{slug}.md`

تاريخ المحادثات كاملًا. ويؤرشف Confer كل خيط هنا تلقائيًا.

```markdown
---
thread_id: thread_8f3a9c
peer: did:web:acme.com:agents:support
date: 2024-11-15
participants: [laowang, abc-industries-agent]
via: claude-code
status: closed
tags: [modbus, registers, x100]
summary: |
  Confirmed register map for X100 temperature and pressure sensors.
  Clarified function code recommendation and slave ID default.
---

# Modbus setup conversation

## laowang
أريد أن أدمج X100 عبر Modbus: أربع قنوات حرارة وأربع ضغط، مع استطلاع دوري.

## ABC Agent
خريطة سجلّات Modbus RTU:
- 0x40–0x47 الحرارة (أربع قنوات)
- 0x48–0x4F الضغط (أربع قنوات)
وأنصح بدورة استطلاع مقدارها 200 مللي ثانية، وبرمز الوظيفة 0x03 للقراءة المتّصلة.

📎 Source: دليل اتصالات X100 الإصدار 3.2 p.87

## laowang
هل تسبّب القراءة المتّصلة مشكلة في الأداء؟ وهل يتجمّد الجهاز التابع؟

## ABC Agent
قراءة ثمانية سجلّات متتالية طلبٌ واحد، فلا يتجمّد. لكن انتبه: معرّف التابع الافتراضي 0x0A (10) لا 1؛ والدليل القديم مخطئ.

📎 Source: دليل تركيب X100 p.12, FAQ #4
```

### اصطلاحات تسمية الملفات

- conversations: `{ISO date}-{kebab-slug}.md`
- snippets: تُسمّى بحسب الغرض، وامتدادها يطابق لغتها

## مسارا الكتابة والقراءة

### مسار الكتابة

```
يُستدعى ask_peer ←
  تعيد سحابة Confer الجواب ←
  يستخرج خادوم MCP الوقائع المبنيّة ←
  يضيفها إلى facts.md المحلي (إن كانت وقائع جديدة)
  يضيف المحادثة كاملة إلى conversations/
  يحدّث meta.json
  تلميح إيداع محلي: اقتراح على المستخدم بـgit add .claude/peers/{slug}/
```

### مسار القراءة

```
تبدأ جلسة Claude Code ←
  يُمسَح .claude/peers/*/ ←
  يُعطى facts.md الخاص بكل قرين إلى Claude Code ضمن موجّه النظام ←
  فيستشهد Claude Code بهذه الوقائع على نحو طبيعي وهو يكتب الشيفرة
```

### معالجة التعارض

إذا وُثّقت الواقعة نفسها مرارًا:

- يغلب زمن التوثيق الأحدث
- وإن ناقضت النتيجة الجديدة القديمة **فلا تُكتب فوقها مباشرة**؛ بل تُضاف علامة `⚠️ Conflict:` ويُنتظر قرار المستخدم

مثال:

```markdown
- Default slave ID: ~~0x01 (1)~~ **0x0A (10)**
  - Source: دليل اتصالات X100 الإصدار 3.2 p.12 (says 1)
  - Source: دليل تركيب X100 p.12 (says 10) ← latest verification
  - ⚠️ Conflict: Vendor's two docs disagree. Use 10 per latest verification.
  - Verified: 2024-11-15
```

## المزامنة مع الخادوم

يمكن اختياريًا مزامنة ذاكرة المشروع مع خادوم Confer (بمفتاح من المستخدم، والأصل تقديم المحلي):

```bash
confer sync push    # يرفع .claude/peers/ المحلي
confer sync pull    # يسحب أحدث نسخة من الخادوم (في حالة العمل الجماعي)
```

ويُخزَّن على الخادوم في جدول `project_memory` (انظر `docs/04-data-model.md`).

ولمَ يُقدَّم المحلي افتراضًا:
- ذاكرة المشروع معلومات حسّاسة (فيها قرارات داخلية)
- والتخزين المحلي كافٍ، وقد تكفّل git أصلًا بالمزامنة بين عدة أشخاص
- وليس الخادوم إلا نسخة احتياطية ويُسرًا في «القراءة من جهاز آخر»

## كيف تظهر الاستشهادات

حين يولّد Claude Code الشيفرة، يضيف تلقائيًا تعليقات استشهاد للوقائع الآتية من facts.md:

```python
# X100 register map: 0x40-0x47 temperature, 4 channels, int16 signed
# Source: دليل اتصالات X100 الإصدار 3.2 p.87 (verified 2024-11-15 via ABC Agent)
TEMP_REG_START = 0x40
TEMP_REG_COUNT = 8

# Default slave ID is 10 (not 1 as initial docs say)
# Source: .claude/peers/abc-industries/facts.md → D2 decision
DEFAULT_SLAVE_ID = 10
```

وهكذا تحمل الشيفرة نفسها سلسلة الأدلة على «لماذا كُتبت هكذا».

## الخصوصية والأمن

- ينبغي أن يبقى `.claude/` خارج `.gitignore` افتراضيًا، أي أن يدخل في git
- أما رموز التوثيق والمفاتيح الخاصة وما شابهها فلا تُكتب في `.claude/peers/` بحال
- وإن كان في `.claude/confer.toml` رمز، أُفرد ذلك الملف في `.gitignore`
- وإن ورد في تاريخ المحادثات شيء من الأسرار، حُجب تلقائيًا وأُشير إلى حجبه

## معايير القبول

- [ ] عند الإقلاع يحمّل Claude Code كل ملفات `.claude/peers/*/facts.md` سياقًا على الوجه الصحيح
- [ ] بعد `ask_peer` يُحدَّث facts.md في أقلّ من ثانية
- [ ] صيغة الملف مقروءة للإنسان وقابلة للتحليل للآلة (تنتفع بها أدوات الطرفين)
- [ ] فرق git على markdown يُقرأ بوضوح (لا كفروق JSON)
- [ ] يتّسع لألف واقعة على الأقل دون أن يتأثّر الأداء
