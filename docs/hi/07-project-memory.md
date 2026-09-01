# Confer — परियोजना स्मृति (.claude/peers/)

Claude Code एकीकरण के तहत ज्ञान परियोजना में किस फ़ाइल-रूप में जमा होता है, यह उसकी परिभाषा है। यह Confer की मूल नवाचारों में से एक है: **विक्रेता का ज्ञान परियोजना के साथ चले — session बदले, डेवलपर बदले या मशीन बदले, खोए नहीं**।

> **स्थिति (2026-09-01)**: यह दस्तावेज़ लक्ष्य-रूप का वर्णन करता है। आज वास्तव में जो मौजूद है वह **सर्वर-पक्ष की परियोजना स्मृति** है — MCP के `read_project_memory` / `write_project_memory` आपके अपने इंस्टैंस की `project_memory` तालिका में `facts` / `decisions` रखते हैं (उपयोगकर्ता × परियोजना × peer के अनुसार अद्वितीय), रूप अब भी Markdown है। नीचे दी गई `.claude/` फ़ाइल-व्यवस्था, `confer.toml` का विश्लेषण और स्वचालित तथ्य-निष्कर्षण अभी लागू नहीं हुए हैं; प्रगति के लिए [`08-mvp-backlog.md`](./08-mvp-backlog.md) का v0.2 देखें।

## निर्देशिका संरचना

हर परियोजना की जड़ में:

```
.claude/
├── confer.toml                   # परियोजना का विन्यास (peers, भरोसे के स्तर)
└── peers/
    ├── abc-industries/
    │   ├── facts.md              # सत्यापित तथ्य, संरचित रूप में
    │   ├── decisions.md          # डिज़ाइन निर्णयों का अभिलेख
    │   ├── conversations/        # पूरा बातचीत-इतिहास
    │   │   ├── 2024-11-15-modbus-setup.md
    │   │   └── 2024-11-20-temp-calibration.md
    │   ├── snippets/             # कोड के टुकड़े
    │   │   └── read_temp.py
    │   └── meta.json             # peer का मेटाडेटा
    └── internal-sdk/
        ├── facts.md
        └── ...
```

git के साथ चलता है, और सभी सहयोगी इसे साझा करते हैं।

## फ़ाइलों का प्रारूप

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

तथ्यों की संरचित सूची। **हर तथ्य के साथ उद्धरण होना ही चाहिए** — बिना उद्धरण वाला «तथ्य» दरअसल hallucination है।

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
  - Source: X100 संचार पुस्तिका v3.2 p.87
  - Source: X100 संस्थापन मार्गदर्शिका p.12 (slave ID note)
  - Verified: 2024-11-15 via ask_peer

## Wiring (X100)

- Power: 24V DC ± 10%, max 500mA
- RS-485 termination: 120Ω at both ends
- Cable length max: 1200m at 9600 baud, 500m at 115200 baud
  - Source: X100 संस्थापन पुस्तिका v3.2 p.45
  - Verified: 2024-11-15

## RTU mode timing

- Inter-character timeout: ≥ 1.5 character times
- Inter-frame timeout: ≥ 3.5 character times
- Recommended polling interval: 200ms or more
  - Source: X100 संचार पुस्तिका v3.2 p.103
  - Note: 100ms works but no CRC retry budget left
  - Verified: 2024-11-15
```

प्रारूप के नियम:

- विषय markdown के दूसरे स्तर के शीर्षकों (`##`) से अलग होते हैं
- हर तथ्य एक सूची-मद है
- मुख्य मान `**गाढ़े**` में उभारे जाते हैं
- हर तथ्य-समूह के अंत में `Source:` पंक्ति और `Verified:` समय-मुहर अनिवार्य है
- कई स्रोत हों तो कई `Source:` पंक्तियाँ लिखी जा सकती हैं

### `decisions.md`

इस परियोजना में लिए गए, इस peer से जुड़े डिज़ाइन निर्णय। facts (विक्रेता के आधिकारिक निष्कर्ष) से अलग, decisions हमारे अपने चुनाव हैं।

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

प्रारूप के नियम:

- हर निर्णय की एक अनन्य ID होती है (`D1`, `D2`, …)
- अनिवार्य क्षेत्र: Date, Made by, Status
- Status: `Active` | `Superseded by D{n}` | `Deprecated`
- विचार किए गए विकल्प गिनाना अनिवार्य है
- संबंधित facts और कोड की ओर कड़ी देना अनिवार्य है

### `conversations/{date}-{slug}.md`

पूरा बातचीत-इतिहास। Confer हर thread को अपने-आप यहाँ संचित कर देता है।

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
X100 का Modbus एकीकरण करना है — 4 तापमान और 4 दाब चैनल, मतदान चाहिए।

## ABC Agent
Modbus RTU का रजिस्टर मानचित्र:
- 0x40–0x47 तापमान (4 चैनल)
- 0x48–0x4F दाब (4 चैनल)
मतदान का चक्र 200 ms रखें, और लगातार पढ़ने के लिए 0x03 फ़ंक्शन कोड।

📎 Source: X100 संचार पुस्तिका v3.2 p.87

## laowang
लगातार पढ़ने से निष्पादन में दिक़्क़त तो नहीं होगी? slave उपकरण अटक तो नहीं जाएगा?

## ABC Agent
लगातार 8 रजिस्टर पढ़ना एक ही अनुरोध है, अटकेगा नहीं। पर ध्यान रहे: slave ID का डिफ़ॉल्ट 0x0A (10) है, 1 नहीं; पुरानी पुस्तिका में ग़लती है।

📎 Source: X100 संस्थापन मार्गदर्शिका p.12, FAQ #4
```

### फ़ाइल के नाम के नियम

- conversations: `{ISO date}-{kebab-slug}.md`
- snippets: उपयोग के अनुसार नाम, और भाषा से मेल खाता विस्तारक

## लिखने और पढ़ने के प्रवाह

### लिखने का रास्ता

```
ask_peer बुलाया गया →
  Confer cloud उत्तर लौटाता है →
  MCP सर्वर संरचित तथ्य निकालता है →
  स्थानीय facts.md में जोड़ता है (यदि तथ्य नया हो)
  पूरी बातचीत conversations/ में जोड़ता है
  meta.json अद्यतन करता है
  स्थानीय commit संकेत: उपयोगकर्ता को सुझाव — git add .claude/peers/{slug}/
```

### पढ़ने का रास्ता

```
Claude Code का session शुरू होता है →
  .claude/peers/*/ खंगाला जाता है →
  हर peer की facts.md सिस्टम प्रॉम्प्ट के हिस्से के रूप में Claude Code को दी जाती है →
  कोड लिखते समय Claude Code स्वाभाविक रूप से इन तथ्यों का हवाला देता है
```

### टकराव का निपटारा

यदि एक ही तथ्य कई बार सत्यापित हो:

- नवीनतम सत्यापन का समय भारी पड़ता है
- यदि नया परिणाम पुराने से टकराए, तो **सीधे ऊपर नहीं लिखा जाता** — `⚠️ Conflict:` का चिह्न जोड़कर उपयोगकर्ता के निर्णय की प्रतीक्षा की जाती है

उदाहरण:

```markdown
- Default slave ID: ~~0x01 (1)~~ **0x0A (10)**
  - Source: X100 संचार पुस्तिका v3.2 p.12 (says 1)
  - Source: X100 संस्थापन मार्गदर्शिका p.12 (says 10) ← latest verification
  - ⚠️ Conflict: Vendor's two docs disagree. Use 10 per latest verification.
  - Verified: 2024-11-15
```

## सर्वर से समकालन

चाहें तो परियोजना की स्मृति Confer के सर्वर से समकालित की जा सकती है (उपयोगकर्ता का स्विच; डिफ़ॉल्ट में स्थानीय को वरीयता):

```bash
confer sync push    # स्थानीय .claude/peers/ चढ़ाता है
confer sync pull    # सर्वर से नवीनतम संस्करण खींचता है (टीम में काम का परिदृश्य)
```

सर्वर पर भंडारण `project_memory` तालिका में होता है (देखें `docs/04-data-model.md`)।

डिफ़ॉल्ट में स्थानीय को वरीयता क्यों:
- परियोजना की स्मृति संवेदनशील जानकारी है (उसमें भीतरी निर्णय होते हैं)
- स्थानीय भंडारण काफ़ी है, और कई लोगों के बीच समकालन git पहले ही सँभाल लेता है
- सर्वर केवल बैकअप है और «दूसरे उपकरण से पढ़ने» की सुविधा

## उद्धरण कैसे दिखते हैं

कोड बनाते समय Claude Code, facts.md से आए तथ्यों पर अपने-आप उद्धरण की टिप्पणी जोड़ देता है:

```python
# X100 register map: 0x40-0x47 temperature, 4 channels, int16 signed
# Source: X100 संचार पुस्तिका v3.2 p.87 (verified 2024-11-15 via ABC Agent)
TEMP_REG_START = 0x40
TEMP_REG_COUNT = 8

# Default slave ID is 10 (not 1 as initial docs say)
# Source: .claude/peers/abc-industries/facts.md → D2 decision
DEFAULT_SLAVE_ID = 10
```

इस तरह कोड स्वयं «ऐसा क्यों लिखा» का प्रमाण-सूत्र साथ लिए चलता है।

## निजता और सुरक्षा

- `.claude/` डिफ़ॉल्ट रूप से `.gitignore` के बाहर रहनी चाहिए (यानी git में जाए)
- पर प्रमाणीकरण के टोकन, निजी कुंजियाँ आदि `.claude/peers/` में कभी नहीं लिखे जाते
- `.claude/confer.toml` में यदि टोकन हो, तो वह फ़ाइल अलग से `.gitignore` में डाली जाती है
- बातचीत के इतिहास में यदि रहस्य आ जाएँ तो वे अपने-आप छिपाए और चिह्नित किए जाते हैं

## स्वीकृति की कसौटी

- [ ] आरंभ पर Claude Code सभी `.claude/peers/*/facts.md` को संदर्भ के रूप में ठीक से लोड करे
- [ ] `ask_peer` के बाद एक सेकंड के भीतर facts.md अद्यतन हो जाए
- [ ] फ़ाइल का प्रारूप मनुष्य के पढ़ने योग्य और मशीन के विश्लेषण योग्य हो (दोनों ओर के औज़ार काम में ला सकें)
- [ ] git diff में markdown का अंतर स्पष्ट पढ़ा जाए (JSON जैसा नहीं)
- [ ] कम से कम 1000 तथ्य समा सकें और निष्पादन पर असर न पड़े
