# Confer — প্রকল্প-স্মৃতি (.claude/peers/)

Claude Code সংযুক্তির অধীনে জ্ঞান কোন ফাইল-রূপে প্রকল্পে জমা হয়, তারই সংজ্ঞা। এটি Confer-এর মূল উদ্ভাবনগুলোর একটি: **সরবরাহকারীর জ্ঞান যেন প্রকল্পের সঙ্গেই চলে — session বদলাক, ডেভেলপার বদলাক বা যন্ত্র বদলাক, হারিয়ে না যায়**।

## ডিরেক্টরির গঠন

প্রতিটি প্রকল্পের মূলে:

```
.claude/
├── confer.toml                   # প্রকল্পের বিন্যাস (peers, আস্থার স্তর)
└── peers/
    ├── abc-industries/
    │   ├── facts.md              # যাচাই করা তথ্য, কাঠামোবদ্ধ
    │   ├── decisions.md          # নকশা-সিদ্ধান্তের নথি
    │   ├── conversations/        # সম্পূর্ণ কথোপকথনের ইতিহাস
    │   │   ├── 2024-11-15-modbus-setup.md
    │   │   └── 2024-11-20-temp-calibration.md
    │   ├── snippets/             # কোডের টুকরো
    │   │   └── read_temp.py
    │   └── meta.json             # peer-এর মেটাডেটা
    └── internal-sdk/
        ├── facts.md
        └── ...
```

git-এর সঙ্গেই চলে, আর সব সহযোগী এটি ভাগ করে নেন।

## ফাইলের বিন্যাস

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

তথ্যের কাঠামোবদ্ধ তালিকা। **প্রতিটি তথ্যের সঙ্গে উদ্ধৃতি থাকতেই হবে** — উদ্ধৃতিহীন «তথ্য» আসলে hallucination।

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
  - Source: X100 যোগাযোগ নির্দেশিকা v3.2 p.87
  - Source: X100 স্থাপন নির্দেশিকা p.12 (slave ID note)
  - Verified: 2024-11-15 via ask_peer

## Wiring (X100)

- Power: 24V DC ± 10%, max 500mA
- RS-485 termination: 120Ω at both ends
- Cable length max: 1200m at 9600 baud, 500m at 115200 baud
  - Source: X100 স্থাপন পুস্তিকা v3.2 p.45
  - Verified: 2024-11-15

## RTU mode timing

- Inter-character timeout: ≥ 1.5 character times
- Inter-frame timeout: ≥ 3.5 character times
- Recommended polling interval: 200ms or more
  - Source: X100 যোগাযোগ নির্দেশিকা v3.2 p.103
  - Note: 100ms works but no CRC retry budget left
  - Verified: 2024-11-15
```

বিন্যাসের রীতি:

- বিষয় আলাদা হয় markdown-এর দ্বিতীয় স্তরের শিরোনাম (`##`) দিয়ে
- প্রতিটি তথ্য একটি তালিকা-আইটেম
- মূল মানগুলো `**মোটা**` করে ফুটিয়ে তোলা হয়
- প্রতিটি তথ্য-গুচ্ছের শেষে `Source:` লাইন আর `Verified:` সময়-ছাপ থাকতেই হবে
- একাধিক উৎস হলে একাধিক `Source:` লাইন লেখা যায়

### `decisions.md`

এই প্রকল্পে নেওয়া, এই peer-সংক্রান্ত নকশা-সিদ্ধান্ত। facts (প্রস্তুতকারকের কর্তৃত্বসম্পন্ন সিদ্ধান্ত) থেকে আলাদা — decisions আমাদের নিজেদের বাছাই।

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

বিন্যাসের রীতি:

- প্রতিটি সিদ্ধান্তের একটি অনন্য ID থাকে (`D1`, `D2`, …)
- আবশ্যিক ক্ষেত্র: Date, Made by, Status
- Status: `Active` | `Superseded by D{n}` | `Deprecated`
- বিবেচিত বিকল্পগুলো তালিকাভুক্ত করা আবশ্যক
- সংশ্লিষ্ট facts ও কোডের দিকে লিংক দেওয়া আবশ্যক

### `conversations/{date}-{slug}.md`

সম্পূর্ণ কথোপকথনের ইতিহাস। Confer প্রতিটি thread আপনা-আপনিই এখানে জমা করে।

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
X100-এর Modbus সংযুক্তি করতে হবে — ৪টি তাপমাত্রা আর ৪টি চাপের চ্যানেল, পোলিং দরকার।

## ABC Agent
Modbus RTU-র রেজিস্টার মানচিত্র:
- 0x40–0x47 তাপমাত্রা (৪ চ্যানেল)
- 0x48–0x4F চাপ (৪ চ্যানেল)
পোলিংয়ের চক্র ২০০ ms রাখুন, আর টানা পড়ার জন্য 0x03 ফাংশন কোড।

📎 Source: X100 যোগাযোগ নির্দেশিকা v3.2 p.87

## laowang
টানা পড়লে কার্যক্ষমতায় সমস্যা হবে না তো? slave যন্ত্র আটকে যাবে না?

## ABC Agent
টানা ৮টি রেজিস্টার পড়া একটিই অনুরোধ, আটকাবে না। তবে খেয়াল রাখুন: slave ID-র ডিফল্ট 0x0A (10), ১ নয়; পুরোনো নির্দেশিকায় ভুল আছে।

📎 Source: X100 স্থাপন নির্দেশিকা p.12, FAQ #4
```

### ফাইলের নামের রীতি

- conversations: `{ISO date}-{kebab-slug}.md`
- snippets: কাজ অনুযায়ী নাম, আর ভাষার সঙ্গে মেলানো এক্সটেনশন

## লেখা ও পড়ার প্রবাহ

### লেখার পথ

```
ask_peer ডাকা হলো →
  Confer cloud উত্তর ফেরাল →
  MCP সার্ভার কাঠামোবদ্ধ তথ্য বার করল →
  স্থানীয় facts.md-এ যোগ করল (তথ্যটি নতুন হলে)
  পুরো কথোপকথন conversations/-এ যোগ করল
  meta.json হালনাগাদ করল
  স্থানীয় commit-এর ইঙ্গিত: ব্যবহারকারীকে পরামর্শ — git add .claude/peers/{slug}/
```

### পড়ার পথ

```
Claude Code-এর session চালু হলো →
  .claude/peers/*/ ঘেঁটে দেখা হলো →
  প্রতিটি peer-এর facts.md সিস্টেম প্রম্পটের অংশ হিসেবে Claude Code-কে দেওয়া হলো →
  কোড লেখার সময় Claude Code স্বাভাবিকভাবেই এই তথ্যগুলোর উল্লেখ করে
```

### দ্বন্দ্ব সামলানো

একই তথ্য যদি একাধিকবার যাচাই হয়:

- সর্বশেষ যাচাইয়ের সময়টিই টেকে
- নতুন ফল পুরোনোর সঙ্গে বিরোধ করলে **সরাসরি উপরে লেখা হয় না** — `⚠️ Conflict:` চিহ্ন জুড়ে ব্যবহারকারীর সিদ্ধান্তের অপেক্ষা করা হয়

যেমন:

```markdown
- Default slave ID: ~~0x01 (1)~~ **0x0A (10)**
  - Source: X100 যোগাযোগ নির্দেশিকা v3.2 p.12 (says 1)
  - Source: X100 স্থাপন নির্দেশিকা p.12 (says 10) ← latest verification
  - ⚠️ Conflict: Vendor's two docs disagree. Use 10 per latest verification.
  - Verified: 2024-11-15
```

## সার্ভারে সমন্বয়

ইচ্ছে করলে প্রকল্পের স্মৃতি Confer-এর সার্ভারে সমন্বয় করা যায় (ব্যবহারকারীর সুইচ; ডিফল্টে স্থানীয়টিই অগ্রগণ্য):

```bash
confer sync push    # স্থানীয় .claude/peers/ তুলে দেয়
confer sync pull    # সার্ভার থেকে সর্বশেষ সংস্করণ টেনে আনে (দলগত কাজের প্রেক্ষিত)
```

সার্ভারে `project_memory` টেবিলে রাখা হয় (দেখুন `docs/04-data-model.md`)।

ডিফল্টে স্থানীয়টি কেন অগ্রগণ্য:
- প্রকল্পের স্মৃতি স্পর্শকাতর তথ্য (তাতে ভিতরের সিদ্ধান্ত থাকে)
- স্থানীয় সংরক্ষণই যথেষ্ট, আর অনেকের মধ্যে সমন্বয় git আগেই সামলে নেয়
- সার্ভার কেবল ব্যাকআপ আর «অন্য যন্ত্র থেকে পড়ার» সুবিধা

## উদ্ধৃতি কীভাবে দেখায়

কোড বানানোর সময় Claude Code, facts.md থেকে আসা তথ্যের গায়ে আপনা-আপনি উদ্ধৃতির মন্তব্য জুড়ে দেয়:

```python
# X100 register map: 0x40-0x47 temperature, 4 channels, int16 signed
# Source: X100 যোগাযোগ নির্দেশিকা v3.2 p.87 (verified 2024-11-15 via ABC Agent)
TEMP_REG_START = 0x40
TEMP_REG_COUNT = 8

# Default slave ID is 10 (not 1 as initial docs say)
# Source: .claude/peers/abc-industries/facts.md → D2 decision
DEFAULT_SLAVE_ID = 10
```

এভাবে কোড নিজেই «কেন এমন লেখা» তার প্রমাণ-শৃঙ্খল বয়ে বেড়ায়।

## গোপনীয়তা ও নিরাপত্তা

- `.claude/` ডিফল্টে `.gitignore`-এর বাইরে থাকা উচিত (অর্থাৎ git-এ যাক)
- তবে প্রমাণীকরণের টোকেন, ব্যক্তিগত চাবি ইত্যাদি `.claude/peers/`-এ কখনও লেখা হয় না
- `.claude/confer.toml`-এ টোকেন থাকলে সেই ফাইলটি আলাদা করে `.gitignore`-এ দেওয়া হয়
- কথোপকথনের ইতিহাসে গোপন কিছু এলে তা আপনা-আপনি ঢেকে দেওয়া হয় ও চিহ্নিত করা হয়

## গ্রহণের মানদণ্ড

- [ ] চালু হওয়ার সময় Claude Code সব `.claude/peers/*/facts.md` প্রসঙ্গ হিসেবে ঠিকমতো তুলে নেয়
- [ ] `ask_peer`-এর পর এক সেকেন্ডের মধ্যে facts.md হালনাগাদ হয়ে যায়
- [ ] ফাইলের বিন্যাস মানুষের পড়ার যোগ্য এবং যন্ত্রের বিশ্লেষণযোগ্য (দুই দিকের সরঞ্জামই কাজে লাগাতে পারে)
- [ ] git diff-এ markdown-এর পার্থক্য স্পষ্ট পড়া যায় (JSON-এর মতো নয়)
- [ ] অন্তত ১০০০টি তথ্য ধরে রাখতে পারে, কার্যক্ষমতা না কমিয়ে
