# Wave 1 执行 Runbook（6 周）

> **全局赌注（leap-of-faith）:** "人们会让自己的 Agent 与他人的 Agent 来回交涉把事办成，而不是自己动手。"
>
> **非创始人硬闸（贯穿全 Runbook，不可绕过）:** 创始人用自己两个账号自测，**只能证明管道（plumbing）通，不能证明赌注成立**。成功只在 **>=2 名独立的、非创始人的真人** 完成了 **非脚本化、有后果（consequential）的** Agent-to-Agent 来回交涉时才计入。创始人双账号交换必须在 **所有** 成功计数中被审计剔除（audited OUT）。本 Runbook 中任何出现"通过 / success / 绿灯 / 验证"的地方，都默认套用此闸——下文每个决策点都重申一次，不允许在任一环节用创始人自测充数。

Wave 1 聚焦两个 idea：**C**（in-IDE 跨人桥）与 **B**（可信 Agent 互操作 SDK / 身份层）。本 Runbook 把 C-E3、C-E1、C-E2、B-E1、B-E2、B-E4（含 H-E1 desk-scan）、C-E4、C-E5 排进 6 周，并明确唯二需要写代码的工程项。所有阈值均逐条溯源到实验数据的 successCriteria，未在数据中出现的数字一律不引入。

---

## 1. 本周即刻行动（Day 0-2）：先做 C-E3 预注册

**Day 0-2 唯一阻塞性动作：完成 C-E3 的 pass/kill 标准预注册（写下并冻结）。任何 C-E2 / C-E5 结果被读出之前，此文本必须已签署冻结。**

### 为什么必须最先（而不是先招募、先写代码）

C-E3 测的是 **C-g3（rank 2 的 META-risk）**：自测性是否是全局赌注的有效代理。它排在 desirability 之前，因为它 **决定了本 probe 里任何其它结果是否可被解读**。如果不先把"什么算通过"钉死，C-E2 / C-E5 一旦出绿灯，就无法区分这是"真陌生人在委派有后果的跨人工作"还是"创始人两个账号把消息发通了"——那个绿灯就是误导整个 portfolio 的假阳性。先注册、后跑实验，才能让所有后续读数可信。

### Day 0-2 必须写下并冻结的内容（预注册文本，逐条对齐 C-E3 successCriteria）

| 条目 | 预注册内容（来源） |
|------|--------------------|
| 通过门槛 | 6-8 对真人配对（12-16 人，**均非创始人**）中，**>=50%** 的配对在 **2 周窗口** 内完成 **>=1 次** 非脚本化、有后果的 Agent-to-Agent 来回交涉（C-E3 hypothesis / successCriteria） |
| "来回交涉"定义 | **>=2 个 round-trip**，且接收方的人 **据此采取了行动**（C-E3 hypothesis） |
| "非脚本化"定义 | 任务是参与者自己的真实任务，**不是创始人给的脚本**（C-E3 setup 第 3 步） |
| "有后果"定义 | 人据答案 / 安排采取了行动，**已记录、可审计**（C-E3 setup 第 3 步） |
| 审计剔除规则 | 必须有书面 audit，证明创始人自己的双账号交换在 **C-E2 / C-E5 的所有"success"计数中被剔除**（C-E3 successCriteria） |
| 仪表化要求 | 记录 round-trip 数、谁发起、接收方是 **Agent 代答 vs 人手动介入**（C-E3 setup 第 4 步） |
| 冻结时点 | 在任何 C-E2 / C-E5 结果被读出 **之前** 签署冻结（C-E3 setup 第 1 步） |

> 这份预注册文本就是 Week 6 决策门、§5 与 §killSignals 第 1 条的判定依据；一旦冻结，**不得回溯修改**。即便后续滑期，注册文本也不动（见 §7）。

---

## 2. 6 周甘特式排期表

owner 用 **role 占位**：**FND**=创始人 / PM，**ENG**=工程，**RES**=用户研究 / 招募，**GTM**=分发 / marketing。effort / timelineDays 取自实验数据。所有"决策点"阈值见 §5 与 §7 的溯源。

| 周 | 实验 | owner | 前置依赖 | 产出（artifact） | 决策点（阈值来源） |
|----|------|-------|----------|------------------|--------------------|
| **W1 (Day0-2)** | **C-E3 预注册**（S, 5d；实测判定在 W4-6） | FND | 无（最先） | 冻结的 pass/kill 文本 + 审计规则脚本草案 | 文本签署冻结 = 一切后续读数前置条件 |
| **W1** | C-E1 招募 + 启动（M, 9d） | RES+FND | C-E3 已注册 | 12-15 名 Claude Code/Cursor 日活开发者名单；3 天日记模板下发 | — |
| **W1** | B-E1 招募 + 启动（M, 12d） | RES+FND | C-E3 | 20 名 agent-framework builder 排期表 | — |
| **W1** | **B-E4 + H-E1 desk-scan 启动**（S, 8d，near-zero cost） | FND | 无 | 竞品 / 商品化扫描清单：Google A2A / MCP / Auth0-Okta / Cloudflare 2025-26 免费身份能力 | 是否已有 distribution-backed 免费参考实现占据 identity slot（killSignals 4 探针） |
| **W2** | C-E1 跑完（日记→30min 访谈→打标） | RES | W1 招募 | 每人 tacit-need 分类计数表 | **C-E1 决策**：>=40% 参与者有 >=1 个真实跨人 tacit need，**且其中 agent-routing 在 >=1/3 case 被判定快于 Slack-DM**？pass→进 C-E2（C-E1 successCriteria） |
| **W2** | B-E1 跑完（20 场 problem interview） | RES | W1 招募 | counterparty-exists / identity-blocker / would-pay 三标计数 | **B-E1 决策**：>=8/20 报真实 cross-owner counterparty 且 identity 为主 blocker，**且 <50% blocker 为非身份类**？（B-E1 successCriteria） |
| **W2** | **C-E2 Wizard 工具开发**（工程项 1，见 §6） | ENG | C-E1 出 pass 信号（供 trigger / 受众设计） | `ask_person_agent` 假 MCP 工具上线 + 埋点 | 工具可被真 Claude Code 注册、Wizard 人工兜底链路通 |
| **W2** | B-E2 landing page 上线（S, 7d） | GTM+ENG | B-E1 信号 | SDK landing + 5 行本地自签 handshake stub + 埋点 | CTA / handshake-completion 埋点上线 |
| **W3** | C-E2 1 周 trial（M, 10d） | FND（Wizard）+ENG | C-E2 工具 + C-E1 受访者池 | 每次调用仪表数据 | **C-E2 决策**：>=25% trial dev 在 7 天内为真实跨人任务 **主动** 调用 >=1 次，且 exit poll 确认"不会只问模型 / web-search"？（C-E2 successCriteria） |
| **W3** | B-E2 引流跑完（>=300 unique visitor） | GTM | B-E2 上线 | CTA 点击率 / handshake 完成率 / "愿接真 peer" Y 率 | **B-E2 决策**：>=25% CTA 点击 **且** >=8% 完成本地 handshake **且** >=30% 完成者答"愿接真 peer"？（B-E2 successCriteria） |
| **W4** | C-E2 收尾 + **非创始人配对实测窗口开**（C-E3 实测） | FND+RES | C-E2 trial + C-E3 注册 | 6-8 对非创始人配对的 round-trip 日志 | C-E3 配对数据开始累积（2 周窗口） |
| **W4** | C-E4 fake-door 定价页（M, 8d） | GTM+ENG | C-E1/C-E2 出 desirability 信号 | landing+pricing（Free vs Pro $9-19/mo）+ Stripe checkout-intent 埋点（**不真扣费**） | — |
| **W5** | C-E4 跑完 + org 访谈（3-5 家 eng-manager） | FND+GTM | C-E4 上线 | view→paid-intent 转化率 + budget-owner 命名数 | **C-E4 决策**：>=8% view→paid-intent **且** >=2/5 org 命名 plausible budget owner？（C-E4 successCriteria） |
| **W5** | **C-E5 marketplace listing 上线**（工程项 2，见 §6；M, 28d，4 周窗口须提前启动） | ENG+GTM | C-E2 工具成熟 | 发布 `@confer/mcp-a2a` + 全漏斗埋点 | install→activation 埋点上线 |
| **W6** | C-E5 首批 cohort 数据 + **C-E3 审计回读** | FND+RES | C-E5 上线 + C-E3 配对窗口满 | install→activation 率（部分）+ solo-installer 招募率 + **非创始人配对审计报告** | **Wave1→Wave2 决策门**（见 §5） |

> **C-E5 注记:** timelineDays=28（4 周窗口、每周一批 install），Week 6 只能拿到首批 / 早期读数。其完整 **>=15% 7 日 activation** 与 **>=30% solo-installer 招到 counterparty**（C-E5 successCriteria）判定会延伸到 Week 6 之后，**不阻塞** Wave 1→2 门——门只需要 C 的非创始人配对证据 + C/B 访谈的跨人需求信号（见 §5）。

---

## 3. 关键路径与并行

### 可并行的轨道（无共享状态）

- **轨道 A（C 桥 desirability）:** C-E3（注册）→ C-E1 → C-E2 → C-E3（实测）→ C-E4 → C-E5
- **轨道 B（B 基础设施）:** B-E1 → B-E2，与轨道 A 完全并行（不同受访者池、不同 owner）
- **轨道 D（desk-scan）:** B-E4 + H-E1 商品化扫描，W1 即起跑，**纯案头、零阻塞**，与一切并行；它 gate 整个 infra 论点（B/H/F），是 §killSignals 第 4 条的探针。

### 关键路径（受 timelineDays 约束）

关键路径在 **轨道 A**，由顺序依赖串成：

```
C-E3 注册(0-2d) → C-E1(9d) → C-E2(10d) → C-E3 实测(窗口2周) → C-E4(8d) → C-E5(28d)
```

- 真正卡 6 周节奏的是 **C-E1(9d) + C-E2(10d) 的串行段**（C-E2 的 trigger / 受众设计依赖 C-E1 产出的真实 tacit-need 信号），共约 19 个工作日，恰好填满 Week 1-3。
- **C-E5(28d)** 是单实验最长，在关键路径末端、且其完整判定不阻塞 Wave 1→2 门，故必须在 **Week 5 提前启动**（不等 C-E4 全跑完），让 4 周窗口的首批数据在 Week 6 可读。
- **C-E3 拆两段:** 注册 5d（W1，必须最先）+ 实测 2 周窗口（W4 开窗，须等 C-E2 产生真实配对后才有素材）。

### 并行调度规则

1. RES 资源在 W1 同时拉两条招募线（C-E1 dev 池 + B-E1 builder 池），两池 **不重叠** 避免污染。
2. ENG 在 W2 优先交付 C-E2 工具（关键路径），B-E2 stub 由 GTM+ENG 轻量并行。
3. desk-scan 完全旁路，任何 role 空档即可推进，W2 出结论。

---

## 4. 每个实验的"开跑清单"

| 实验 | 招募名单 | Wizard / 兜底人 | landing / 工具 | 埋点 |
|------|----------|------------------|----------------|------|
| **C-E3** | 6-8 对真人配对（12-16 人，**全非创始人**，从 C-E1/C-E2 池抽） | — | — | round-trip 计数、发起方、**Agent 代答 vs 人手动介入**；**审计脚本剔除创始人双账号** |
| **C-E1** | 12-15 名 Claude Code/Cursor 日活开发者（创始人网络 + 2-3 个 dev Slack/Discord 社区） | — | 3 天轻量日记模板（每次 alt-tab 问人时记一条 Slack 长度便签） | 日记条目分类标签：code/library/repo（模型可解）vs 真跨人 tacit need；participant-level 计数 |
| **C-E2** | 8-12 名 trial dev；每人预置 2-3 个 **已同意做 relay target 的真实队友** | **创始人本人做 Wizard**，分钟级人工兜底每次 ask（隔离 latency 混淆） | `ask_person_agent(person, question)` 假 MCP 工具（真注册、答案 100% 人工中继）+ 一行 README（**不诱导使用**） | 每次调用：谁问 / 问题文本 / "模型本可答否"标志 / "是否有 Slack DM 备选开着"标志；7 天内主动调用率 |
| **B-E1** | 20 名 LangChain/CrewAI/MCP-host/AutoGen builder（dev Discord、MCP/A2A GitHub issue、r/LocalLLaMA、Confer 联系人） | — | 固定 30min problem-interview 脚本（**无 pitch**） | transcript 三标：counterparty-exists Y/N、identity-named-blocker Y/N、would-pay-now Y/N；blocker 排序（identity vs capability/liability/output） |
| **B-E2** | >=300 targeted visitor（2-3 dev channel：MCP/A2A thread、Show HN/Reddit、framework Discord） | — | 一页 landing（标题"5 行可信 Agent 互操作"）+ 真实可复制 5 行 snippet + **本地自签 sign→verify handshake stub（无 peer 网络）** + email 捕获 | unique visitor、CTA 点击率、email 捕获、stub opt-in handshake 完成 ping、跑完后一问"愿接真 peer Y/N" |
| **B-E4 + H-E1** | — | — | 案头扫描（web + docs），无需 landing | 输出清单：Google A2A / MCP / Auth0-Okta / Cloudflare 在 2025-26 免费 ship 的 agent 身份能力；是否已有 blessed 免费参考实现占 identity slot |
| **C-E4** | 流量来自 MCP marketplace listing + trial-dev cohort + 2-3 dev community post；拒付的 5 人做 Van Westendorp 微调研；3-5 家 eng-manager 组织访谈 | — | landing+pricing 页（Free 单联系人/env-var vs Pro $9-19/mo：hosted multi-tenant auth / stranger discovery / priority replies——**仅作为定价页文案描述的假门承诺，不在 Wave 1 实现**）+ Stripe checkout-intent（**不真扣费**，"early access, won't be billed yet"） | pricing-view→paid-intent 转化（Stripe checkout-intent 或 card capture）；org 命名 budget owner 数 |
| **C-E5** | 零付费投放；只靠 marketplace + organic post（验证 self-distributing & CAC≈$0）；每周一 cohort | — | 发布 `@confer/mcp-a2a` 到 Claude Code/Cursor MCP marketplace（sharp value-prop + 2 行 quickstart） | 全漏斗：impression→install→whoami→register→recruit+accept counterparty→first successful ask；**显式标记最难一步：solo installer 是否成功招到第二个真人** |

> **C-E4 定价页诚实声明:** "hosted multi-tenant auth / stranger discovery / priority replies"是 **fake-door 文案承诺**，用于测 paid-intent，**Wave 1 不构建** 这些能力（它们均超出 ground-truth 现状，见 §6）。定价页须明示"early access, you won't be billed yet"，绝不暗示功能已就绪。

---

## 5. 决策门检查点（Week 6 Wave1→Wave2 gate）

### 通过判定（同时满足，全部套用非创始人硬闸）

> **闸前条件（不可跳过）:** §1 的 C-E3 预注册文本已签署冻结，且书面审计已把 **创始人所有双账号交换从 C-E2/C-E5 的全部 success 计数中剔除**。若此审计缺失或未通过，则任何"绿灯"按 C-E3 decisionRule 一律判为 **假阳性**，门 **不通过**。

1. **C 端非污染证据（killSignals 1 / C-E3 successCriteria）:** C 产生 **>=2 对独立的、非创始人真人** 完成非脚本化、有后果（>=2 round-trip、人据此行动）的来回交涉，**且** 上述审计成立。
2. **跨人需求信号（gates Wave1→Wave2 condition / wave1.exitCriteria）:** C/B 受访者中浮现真实 cross-owner counterparty 需求，且该场景下 agent-routing **胜过** 人直连备选（Slack DM / 已知 API key）：
   - **C 侧（C-E1 successCriteria）:** >=40% C-E1 参与者浮现真实跨人 tacit need，且其中 agent-routing 在 >=1/3 case 被判快于 Slack-DM。
   - **B 侧（B-E1 successCriteria）:** >=8/20（40%）B-E1 受访者报真实 cross-owner counterparty 且命名 identity 为主 blocker，且 <50% blocker 为非身份类。

### 动作分支（逐条引用 §gates / §killSignals）

| 结果 | 动作 |
|------|------|
| **通过** | Fund Wave 2（A 消费者代理 + D 目录）。全局赌注首次有未污染证据，A/D desirability 测试可对干净 baseline 解读。（gates ifPass） |
| **整体不通过（C 配对拿不到 2 对独立非创始人真人）** | 触发 **killSignals 第 1 条**：全局赌注在实践中为假。Halt 所有依赖 counterparty 的网络型 idea（除 standalone G）。若失败模式是"管道通但无真实陌生人需求"→ 转向单机工具，**G memory-as-a-service 是唯一网络无关 hedge**；重审全局赌注是否错。（gates ifFail / killSignals 1） |
| **仅 B 身份痛点失败、C 需求成立** | Drop 付费 infra 论点（**B/H/F**），保留应用路径（**A/D/J**）。（gates ifFail） |
| **desk-scan 命中"免费参考实现已占 identity slot"** | 触发 **killSignals 第 4 条**：ownership window 关闭，DID:web / 签名 / AgentFacts 定价权归零。同时杀 B/H/F infra 货币化脊柱；pivot 从"拥有 trust 层"转为"在 incumbent 标准上建应用"。 |
| **C-E2 出绿但 C-E3 配对失败（<50%）** | 按 **C-E3 decisionRule**：C-E2/C-E5 的绿灯判为 **假阳性（plumbing not bet）**，作废这些结果，**不** 据此 green-light portfolio，重设实验逼出独立真人证据。 |

> **FAIL EITHER（C 或 B）→ 不按原设计 fund Wave 2；全局赌注存疑——pivot 或 kill。**（wave1.exitCriteria）

---

## 6. 工程范围说明（唯二需写代码项 + ground-truth 边界）

Wave 1 全程 **只有两项需要写代码**：C-E2 的 Wizard-of-Oz 工具、C-E5 的 marketplace listing。其余全是访谈 / landing stub / 案头扫描。

> **Ground-truth 现状（不得在 Wave 1 之外发明能力）:** 仓库今天的出站能力 = 向另一 agent 的 HTTP 端点 **POST 一条签名 A2A 消息（DID:web + RFC 9421）**。仓库内 **没有** 电话 / SMTP 邮件 / 浏览器自动化，"对人 / 对网站动作"是 **greenfield 不可靠前沿**。find/list MCP 工具 **只读已接受的 contact**，**无 scheduling 工具**，现 `packages/mcp-a2a` 以 `CONFER_USERNAME/PASSWORD` env-var 作 **单一共享账号**——**无** per-user OAuth / device-code 登录、**无** 每用户签名密钥托管、**无** hosted 多租户 gateway。permission inbox 是 **连接同意（connect）** 收件箱，不是 errand 决策卡。classifyPermissionLevel 是 **字符串前缀匹配**，可被对方 / 网站的措辞重构绕过——**不是可靠的策略分类器**。以上一律不在 Wave 1 构建或承诺。

### 工程项 1：C-E2 `ask_person_agent` Wizard-of-Oz MCP 工具

**最小实现边界（in scope）:**

- 注册一个 **真实可被 Claude Code 识别** 的 MCP 工具 `ask_person_agent(person, question)`（MCP SDK schema validator 严格，须用真 Claude Code 连接实测——见项目 Pitfalls）。
- 答案 **100% 人工中继**：工具把 `(person, question)` 落到一个创始人可见的队列（最简：写入一张表 / 一个 channel），**创始人本人** reach 被点名的队友、把回答回填。**latency 由 Wizard 分钟级人工兜底**，不做任何自动应答。
- 复用现有 A2A 管道仅作 **消息载体**（现有 outbound = 签名 A2A POST），**不新增协议、不新增对外动作面**。
- 埋点：每次调用记录 谁问 / 问题文本 / "模型本可答否"标志 / "是否有 Slack DM 备选"标志。

**明确不做（out of scope，均为 ground-truth 之外的 greenfield）:**

- ❌ stranger discovery：person 只能是 **预置的、已同意的真实队友**（C-E2 setup 第 2 步），不做陌生人发现 / 推荐。
- ❌ 真·自动 Agent 应答：答案 100% 人工中继（这正是 Wizard-of-Oz 的定义）。
- ❌ per-user OAuth / device-code / 每用户签名密钥托管 / multi-tenant——沿用现状 `CONFER_USERNAME/PASSWORD` 单账号 env-var 模式。
- ❌ scheduling 工具（仓库不存在，不新建）。
- ❌ 任何对人 / 对网站的真实动作（电话 / 邮件 / 浏览器）——全是 greenfield 前沿，本探针不碰。
- ❌ 依赖 classifyPermissionLevel 做安全判定——它是可绕过的前缀匹配；Wizard 全程人工把关，正是为规避此面。

### 工程项 2：C-E5 `@confer/mcp-a2a` marketplace listing + 漏斗埋点

**最小实现边界（in scope）:**

- 把 **现有** `packages/mcp-a2a` 发布到 Claude Code / Cursor MCP marketplace（sharp value-prop listing + 2 行 quickstart）。
- 端到端漏斗埋点：impression → install → first boot（`whoami`）→ register → recruit+accept mutual contact（两侧 gate）→ first successful ask。
- **显式标记最难一步**：solo installer 是否成功招到第二个真人配对（anti-self-distribution 风险，C-E5 setup 第 3 步）。find/list 工具 **只读已接受的 contact**（现状），listing 不改这一行为。

**明确不做（out of scope）:**

- ❌ multi-tenant hosted gateway / 每用户 OAuth / 每用户签名密钥托管——安装仍是现状单账号 env-var 模式。
- ❌ stranger discovery / scheduling——listing 不承诺、不实现。
- ❌ 任何付费基础设施（C-E5 要求零付费投放以验证 CAC≈$0）。

> 两项都刻意停在"探针"边界：足够产生 revealed-preference 与漏斗数据，但 **不提前建任何 ground-truth 之外的能力**。

---

## 7. 风险与回退

| 风险 | 触发信号（阈值来源） | 回退动作 |
|------|----------------------|----------|
| **非创始人两人闸过不去（最高风险）** | 跨 C（及后续 A/I 的 WoZ）反复无法凑齐 2 名独立非创始人真人完成非脚本化有后果交涉，只有创始人双账号 / 脚本 demo "work"（killSignals 1） | 判定全局赌注实践为假；kill / 彻底重定位所有依赖 counterparty 的 idea（除 standalone G）；转单机工具，G 为唯一网络无关 hedge |
| **C-E2 绿灯是假阳性（plumbing not bet）** | C-E2 出绿但 C-E3 非创始人配对 <50%（C-E3 decisionRule） | 作废 C-E2/C-E5 结果，不 green-light portfolio，重设实验逼独立真人证据 |
| **C-E1 失败：IDE 需求模型/web/Slack 可解** | <40% 参与者浮现真实跨人 tacit need（C-E1 successCriteria / decisionRule） | C-v1 falsified；de-prioritize idea C，整个 agent-to-agent portfolio 拉 desirability 红旗，build 前 escalate |
| **C-E2 失败：need 存在但打不过 Slack-DM/模型** | <25% trial dev 主动调用（C-E2 successCriteria / decisionRule） | 视 C-v1 为 not-yet-validated；重做 trigger/surface 再跑，不进 build |
| **B-E1 失败：流量压倒性 intra-trust** | <8/20 报真实 cross-owner counterparty（B-E1 successCriteria / decisionRule） | SDK 是"找市场的解法"；halt B，重排为先建 cross-owner 网络（A/D）；若 blocker 真但非 identity → pivot wedge 到被点名的 blocker |
| **B-E2 onboarding 友好但 handshake 完成率远低 8%** | CTA 过但 handshake-completion 远低 8%（B-E2 decisionRule） | "5 行"是 marketing 非真实；先修 DID:web hosting / key mgmt 摩擦再 scale，**暂不** 对 GTM 下结论 |
| **ownership window 关闭** | desk-scan（B-E4/H-E1）发现 hyperscaler / 主导框架已把可验证 agent 身份 / 委派 token / trust scoring 作为 **免费 native runtime default** ship（killSignals 4） | DID:web/签名/AgentFacts 定价权归零；杀 B/H/F infra 货币化脊柱；pivot 到在 incumbent 标准上建应用 |
| **C-E5 self-distributing 论点破** | <15% install 7 日 activation **或** <30% solo installer 招到 counterparty（C-E5 successCriteria / decisionRule） | 两侧 gate 杀掉自分发；GTM pivot 到 seeded-cluster / community sales，丢掉"self-distributing" thesis（此判定可延到 Week 6 后，**不阻塞** Wave1→2 门） |
| **C-E4 失败：devs expect free** | <8% view→paid-intent **或** <2/5 org 命名 budget owner（C-E4 successCriteria / decisionRule） | C 为 free-connector cost center；找 org/value-capture wedge，或把 C 降为付费 Wave-2 idea 的 top-of-funnel loss-leader，非独立产品 |
| **关键路径滑期（C-E1+C-E2 串行段超期）** | W3 末 C-E2 trial 未跑完 | C-E5（28d 窗口）已在 W5 提前独立启动、不依赖 C-E4 全跑完，可吸收部分滑期；C-E3 实测窗口可顺延但 **注册文本不动**（已冻结，见 §1） |
| **catastrophic autonomy slip（前瞻预警）** | 任何 live concierge/WoZ 中 Agent 越界花钱或法律承诺（killSignals 3；注：现状 classifyPermissionLevel 是可被措辞重构绕过的前缀匹配，非可靠护栏） | 单次即 trust-ending；停所有 real-world-action idea（A/J/E/I）直至 containment 证明——Wave 1 的 C-E2 **全程人工中继** 正是为规避此面 |
