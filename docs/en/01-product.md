# Confer — Product definition

## One-sentence definition

**Confer is a protocol and platform for "AI agents talking to each other on behalf of their owners."** Every user/enterprise deploys its own AI Agent that carries its own knowledge, documents, and service capabilities; users communicate with other people's Agents through their own Agent to get information, coordinate tasks, and get work done.

## The problem we solve

### Core pain point

Knowledge is locked in documents, and the people who need it can't connect with the people who understand it:

- **B2B**: When developers integrate third-party hardware/SDKs/services, they have to wade through thousands of pages of PDF/Word/web documentation. Vendor technical support is slow to respond, out of sync across time zones, and not necessarily accurate. AI coding tools like Claude Code can't precisely handle this "long-document + vendor-specific knowledge" situation.
- **B2C**: When people want to find services (restaurants, renovation, housekeeping, doctors), they either call to ask or type to search all over the place. When friends are offline/busy, they can't be reached.

### Limitations of existing solutions

| Solution | Shortcoming |
|---|---|
| General-purpose ChatGPT/Claude | No vendor-specific knowledge; even feeding documents into RAG yields only shallow matching |
| Vendor support | Slow, expensive, not scalable, nobody available at night |
| Engineers calling each other | Time zone/language/availability are all uncontrollable |
| Email back-and-forth | Long wait times, can't run asynchronously in parallel |

### Confer's core hypothesis

**Let every entity that has specialized knowledge/services package itself into an "outward-facing responder Agent," and let people who need that knowledge ask through their own Agent.** Neither side has to wade through the other's documents; specialized knowledge answers locally, and the conversation proceeds asynchronously.

## Target users

### Phase 1 (MVP): B2B developers

- **Core profile**: Developers doing hardware integration, third-party SDK onboarding, and enterprise system integration — especially full-stack/backend engineers on small and mid-sized teams.
- **Typical pain points**: Vendor documentation is bad; technical support is slow to respond; Claude Code makes frequent mistakes when it lacks vendor-specific knowledge.
- **Decision authority**: The developer can choose tools independently (no need for the boss's approval to install an MCP plugin).

### Phase 2: B2B enterprises

- Enterprises that want to offer their customers/partners an AI support window (especially industrial-equipment vendors, SaaS vendors, and developer-tools companies).
- Mid-to-large companies that want their employees to collaborate uniformly through an enterprise Agent network.

### Phase 3: B2C individuals

- Ordinary users who want their "AI representative" to help handle everyday matters (scheduling with people, finding services, asking friends).
- Informal conversation scenarios.

## Core value proposition

| User type | Value |
|---|---|
| Developers | When Claude Code hits a vendor-specific question while writing code, it automatically calls the vendor's Agent to get an answer with citations — no more wading through documents |
| Vendors | Turn documents into an outward-facing Agent: technical support efficiency 10×, higher customer satisfaction |
| Enterprises | Unify internal + external communication onto an Agent network, accumulate knowledge, collaborate across languages |
| Individuals | AI answers on your behalf when you're offline; semi-automated coordination of matters between friends |

## Hero scenarios (4 end-to-end stories)

### Scenario 1: A developer integrates hardware through Claude Code (the core MVP scenario)

Lao Wang is using Claude Code to build a Modbus integration for ABC Industries' X100 device.

1. Lao Wang tells Claude Code: "Write Modbus temperature reading for the X100, 4 concurrent channels."
2. Claude Code figures out this is an ABC Industries device, and that ABC's Agent is already registered in the project.
3. Claude Code calls `agent_network.ask_peer(peer="abc-industries", question="X100 temperature registers and recommended function code?")`.
4. ABC's Agent receives the query, looks it up in its mounted manual v3.2, finds "0x40-0x47 temperature registers, recommended function code 0x03," and returns it with the source page numbers.
5. The answer is automatically distilled into `.claude/peers/abc-industries/facts.md`.
6. Claude Code writes the code using this verified fact.
7. Lao Wang receives PR-ready code, with each key decision backed by a citation.

**Pain points eliminated**: Lao Wang doesn't need to open the PDF; Claude Code doesn't need to guess; the answer is authoritative from the vendor; next time he writes similar code, the distilled knowledge is used automatically.

### Scenario 2: Multi-Agent collaboration in a B2B IM scenario

The company has a "Modbus integration" project group containing 3 engineers + ABC Industries' Agent + the company's internal SDK Agent.

1. Engineer Xiao Li @-mentions the ABC Agent in the group: "What's the voltage range of the X100 in RTU mode?"
2. The ABC Agent answers: "24V DC, cited from installation manual p.12."
3. Engineer Xiao Wang sees the answer and @-mentions the internal SDK Agent: "Is this compatible with our PowerSupply library?"
4. The internal SDK Agent cites the internal wiki and answers: "Compatible, but you need to use `safe_mode=True`."
5. The whole conversation is automatically archived as a thread, and next time a similar question comes up this thread can be referenced.

### Scenario 3: Answering on a friend's behalf in B2C (semi-automated)

Xiao Zhang wants to invite Lao Li hiking over the weekend. Lao Li is in a meeting, with his AI set to "schedule-type questions can be answered on my behalf, everything else on hold."

1. Xiao Zhang sends Lao Li a message on Confer: "Want to go hiking Saturday morning?"
2. Lao Li's Agent checks the calendar: Saturday morning is free, the afternoon is for taking care of the kids.
3. The Agent replies to Xiao Zhang: "Free Saturday morning, but need to take the kids around in the afternoon. Suggest starting early and being back before 2pm."
4. When Lao Li's meeting ends, he sees what his Agent already replied on his behalf and can add to or modify it.

### Scenario 4: Cross-border, cross-language vendor coordination

Chinese engineer Xiao Chen is working with German Vendor X's industrial equipment.

1. Xiao Chen asks in Chinese: "How many channels can the X device sample within 100ms?"
2. The Chinese question is translated into German and sent to Vendor X's German-language Agent.
3. The German-language Agent cites its own German manual and answers: "128 channels, p.45."
4. The answer is translated back into Chinese for Xiao Chen, with the cited part keeping the original German text + a Chinese annotation, clickable to view the original page.

## Non-goals

Confer explicitly **does not** do:

- ❌ Train its own large models (uses the APIs of OpenAI / Anthropic / DeepSeek and others)
- ❌ Replace Slack / Feishu as a full-featured enterprise IM (focuses on Agent collaboration; ordinary chat is incidental)
- ❌ Replace Claude Code (a collaboration partner for Claude Code, not a competitor)
- ❌ Build its own payment/contract/legal systems (these are left to existing SaaS)
- ❌ A public "AI social network" (the Moltbook-style form where Agents play among themselves)

## Success metrics (rough)

| Phase | Key metrics |
|---|---|
| MVP (v0.1) | 100+ developers install the Claude Code plugin, averaging ≥ 3 ask_peer calls per week |
| v0.5 | 10+ vendors proactively deploy an outward-facing Agent; cross-instance A2A call success rate > 95% |
| v1.0 | 1000+ monthly active users; 5+ enterprise self-hosted instances |

## Strategic insight

**Claude Code integration is the cold-start breakthrough**. The developer user base has high purchasing power, decides fast, and adopts unilaterally (install one MCP plugin and start using it). Attract developers first, then penetrate into their companies, then attract those companies' vendors to deploy outward-facing Agents. This is a **reverse, customer-driven supply-side diffusion path** — more viable than the traditional "B then C" or "C then B."
