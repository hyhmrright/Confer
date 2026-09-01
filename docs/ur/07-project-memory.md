# Confer — منصوبہ یادداشت (.claude/peers/)

Claude Code کے انضمام کے تحت علم کس فائل صورت میں منصوبے کے اندر جمع ہوتا ہے، یہ اسی کی تعریف ہے۔ یہ Confer کی بنیادی ایجادات میں سے ایک ہے: **فراہم کنندہ کا علم منصوبے کے ساتھ چلے — session بدلے، ڈویلپر بدلے یا مشین بدلے، ضائع نہ ہو**۔

## ڈائریکٹری کی ساخت

ہر منصوبے کی جڑ میں:

```
.claude/
├── confer.toml                   # منصوبے کی ترتیب (peers، بھروسے کے درجے)
└── peers/
    ├── abc-industries/
    │   ├── facts.md              # تصدیق شدہ حقائق، ساختہ صورت میں
    │   ├── decisions.md          # ڈیزائن کے فیصلوں کا ریکارڈ
    │   ├── conversations/        # گفتگو کی مکمل تاریخ
    │   │   ├── 2024-11-15-modbus-setup.md
    │   │   └── 2024-11-20-temp-calibration.md
    │   ├── snippets/             # کوڈ کے ٹکڑے
    │   │   └── read_temp.py
    │   └── meta.json             # peer کا میٹا ڈیٹا
    └── internal-sdk/
        ├── facts.md
        └── ...
```

git کے ساتھ چلتی ہے، اور تمام رفقائے کار اسے بانٹتے ہیں۔

## فائلوں کی صورت

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

حقائق کی ساختہ فہرست۔ **ہر حقیقت کے ساتھ حوالہ ہونا ہی چاہیے** — بلا حوالہ «حقیقت» دراصل hallucination ہے۔

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
  - Source: X100 مواصلاتی دستی v3.2 p.87
  - Source: X100 تنصیب رہنما p.12 (slave ID note)
  - Verified: 2024-11-15 via ask_peer

## Wiring (X100)

- Power: 24V DC ± 10%, max 500mA
- RS-485 termination: 120Ω at both ends
- Cable length max: 1200m at 9600 baud, 500m at 115200 baud
  - Source: X100 تنصیب دستی v3.2 p.45
  - Verified: 2024-11-15

## RTU mode timing

- Inter-character timeout: ≥ 1.5 character times
- Inter-frame timeout: ≥ 3.5 character times
- Recommended polling interval: 200ms or more
  - Source: X100 مواصلاتی دستی v3.2 p.103
  - Note: 100ms works but no CRC retry budget left
  - Verified: 2024-11-15
```

صورت کے اصول:

- موضوع markdown کے دوسرے درجے کے عنوانات (`##`) سے الگ ہوتے ہیں
- ہر حقیقت ایک فہرستی مد ہے
- کلیدی قدریں `**موٹے**` میں نمایاں کی جاتی ہیں
- ہر حقائقی گروہ کے آخر میں `Source:` سطر اور `Verified:` وقت کی مہر لازم ہے
- کئی ماخذ ہوں تو کئی `Source:` سطریں لکھی جا سکتی ہیں

### `decisions.md`

اس منصوبے میں کیے گئے، اس peer سے متعلق ڈیزائن کے فیصلے۔ facts (فراہم کنندہ کے سند یافتہ نتائج) سے مختلف، decisions ہمارے اپنے انتخاب ہیں۔

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

صورت کے اصول:

- ہر فیصلے کی ایک منفرد ID ہوتی ہے (`D1`، `D2`، …)
- لازمی خانے: Date، Made by، Status
- Status: `Active` | `Superseded by D{n}` | `Deprecated`
- زیرِ غور متبادل گنوانا لازم ہے
- متعلقہ facts اور کوڈ کی طرف واپس ربط دینا لازم ہے

### `conversations/{date}-{slug}.md`

گفتگو کی مکمل تاریخ۔ Confer ہر thread کو خود بخود یہاں محفوظ کر دیتا ہے۔

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
X100 کا Modbus انضمام کرنا ہے — درجۂ حرارت کے 4 اور دباؤ کے 4 چینل، پولنگ چاہیے۔

## ABC Agent
Modbus RTU کا رجسٹر نقشہ:
- 0x40–0x47 درجۂ حرارت (4 چینل)
- 0x48–0x4F دباؤ (4 چینل)
پولنگ کا دورانیہ 200 ms رکھیں، اور مسلسل پڑھنے کے لیے 0x03 فنکشن کوڈ۔

📎 Source: X100 مواصلاتی دستی v3.2 p.87

## laowang
مسلسل پڑھنے سے کارکردگی کا مسئلہ تو نہ ہو گا؟ slave آلہ اٹک تو نہیں جائے گا؟

## ABC Agent
مسلسل 8 رجسٹر پڑھنا ایک ہی درخواست ہے، اٹکے گا نہیں۔ مگر خیال رہے: slave ID کی طے شدہ قدر 0x0A (10) ہے، 1 نہیں؛ پرانی دستی میں غلطی ہے۔

📎 Source: X100 تنصیب رہنما p.12, FAQ #4
```

### فائل کے نام کے اصول

- conversations: `{ISO date}-{kebab-slug}.md`
- snippets: مقصد کے مطابق نام، اور زبان سے میل کھاتا لاحقہ

## لکھنے اور پڑھنے کے بہاؤ

### لکھنے کا راستہ

```
ask_peer پکارا گیا ←
  Confer cloud جواب لوٹاتا ہے ←
  MCP سرور ساختہ حقائق نکالتا ہے ←
  مقامی facts.md میں جوڑتا ہے (اگر حقیقت نئی ہو)
  پوری گفتگو conversations/ میں جوڑتا ہے
  meta.json تازہ کرتا ہے
  مقامی commit کا اشارہ: صارف کو تجویز — git add .claude/peers/{slug}/
```

### پڑھنے کا راستہ

```
Claude Code کا session شروع ہوتا ہے ←
  .claude/peers/*/ کھنگالا جاتا ہے ←
  ہر peer کی facts.md نظامی پرامپٹ کے حصے کے طور پر Claude Code کو دی جاتی ہے ←
  کوڈ لکھتے ہوئے Claude Code فطری طور پر انہی حقائق کا حوالہ دیتا ہے
```

### تصادم کا نمٹاؤ

اگر ایک ہی حقیقت کئی بار تصدیق ہو:

- تازہ ترین تصدیق کا وقت غالب آتا ہے
- نیا نتیجہ پرانے سے ٹکرائے تو **سیدھا اوپر نہیں لکھا جاتا** — `⚠️ Conflict:` کا نشان جوڑ کر صارف کے فیصلے کا انتظار کیا جاتا ہے

مثلاً:

```markdown
- Default slave ID: ~~0x01 (1)~~ **0x0A (10)**
  - Source: X100 مواصلاتی دستی v3.2 p.12 (says 1)
  - Source: X100 تنصیب رہنما p.12 (says 10) ← latest verification
  - ⚠️ Conflict: Vendor's two docs disagree. Use 10 per latest verification.
  - Verified: 2024-11-15
```

## سرور سے ہم آہنگی

چاہیں تو منصوبے کی یادداشت Confer کے سرور سے ہم آہنگ کی جا سکتی ہے (صارف کا سوئچ؛ طے شدہ طور پر مقامی کو ترجیح):

```bash
confer sync push    # مقامی .claude/peers/ چڑھاتا ہے
confer sync pull    # سرور سے تازہ ترین نسخہ کھینچتا ہے (ٹیم میں کام کا منظر)
```

سرور پر `project_memory` جدول میں محفوظ ہوتا ہے (دیکھیں `docs/04-data-model.md`)۔

طے شدہ طور پر مقامی کو ترجیح کیوں:
- منصوبے کی یادداشت حساس معلومات ہے (اس میں اندرونی فیصلے ہوتے ہیں)
- مقامی ذخیرہ کافی ہے، اور کئی لوگوں کے درمیان ہم آہنگی git پہلے ہی سنبھال لیتا ہے
- سرور محض بیک اپ ہے اور «دوسرے آلے سے پڑھنے» کی سہولت

## حوالے کیسے دکھائی دیتے ہیں

کوڈ بناتے وقت Claude Code، facts.md سے آئے حقائق پر خود بخود حوالے کا تبصرہ جوڑ دیتا ہے:

```python
# X100 register map: 0x40-0x47 temperature, 4 channels, int16 signed
# Source: X100 مواصلاتی دستی v3.2 p.87 (verified 2024-11-15 via ABC Agent)
TEMP_REG_START = 0x40
TEMP_REG_COUNT = 8

# Default slave ID is 10 (not 1 as initial docs say)
# Source: .claude/peers/abc-industries/facts.md → D2 decision
DEFAULT_SLAVE_ID = 10
```

یوں کوڈ خود «ایسا کیوں لکھا» کی شہادت کی زنجیر ساتھ لیے چلتا ہے۔

## نجی حیثیت اور سلامتی

- `.claude/` کو طے شدہ طور پر `.gitignore` سے باہر رہنا چاہیے (یعنی git میں جائے)
- مگر توثیق کے ٹوکن، نجی کلیدیں وغیرہ `.claude/peers/` میں کبھی نہیں لکھی جاتیں
- `.claude/confer.toml` میں اگر ٹوکن ہو تو وہ فائل الگ سے `.gitignore` میں ڈالی جاتی ہے
- گفتگو کی تاریخ میں کوئی راز آ جائے تو وہ خود بخود چھپا دیا جاتا ہے اور نشان زد کیا جاتا ہے

## قبولیت کے معیار

- [ ] آغاز پر Claude Code تمام `.claude/peers/*/facts.md` کو سیاق کے طور پر درست لوڈ کرے
- [ ] `ask_peer` کے بعد ایک سیکنڈ کے اندر facts.md تازہ ہو جائے
- [ ] فائل کی صورت انسان کے پڑھنے کے قابل اور مشین کے تجزیے کے قابل ہو (دونوں طرف کے اوزار کام میں لا سکیں)
- [ ] git diff میں markdown کا فرق صاف پڑھا جائے (JSON جیسا نہیں)
- [ ] کم از کم 1000 حقائق سما سکیں اور کارکردگی متاثر نہ ہو
