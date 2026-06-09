# PRD —— 想法 C｜MCP ↔ A2A 桥

## 1. 一句话定位 + portfolio 角色

**一句话定位：** 让开发者在 Claude Code / Cursor 里，用一个 MCP 工具把任务发给「某个特定真人」的 Agent，由对方 Agent 代答，而不是自己去 web 搜索、问模型、或在 Slack 上私聊那个人。

**在 portfolio 中的角色 —— 最便宜探针（probe，不是产品）：** C 是全局赌注「人们会让自己的 Agent 与其他人的 Agent 来回沟通把事办成，而不是亲自动手」在 IDE 场景里的最小、最便宜的本地实例。它复用已存在的 `packages/mcp-a2a` + gateway consult flow，因此**它要花钱的地方几乎全在「验证」而非「构建」**。C 是 Wave 1 的两个探针之一（与 B 并列），目标是用最低成本判断「跨人需求是否真实存在」，**不是**把它做成可售卖的完整产品。

> **诚实边界（贯穿全文的硬约束 —— ground truth from the repo）：**
> - 当前出站能力 = 向另一个 Agent 的 HTTP 端点 POST 一条签名 A2A 消息（DID:web + RFC 9421）。仓库里**没有电话、没有 SMTP/邮件发送、没有浏览器自动化** —— 「替人对网站/真人采取行动」是 greenfield，不在本探针内。
> - `packages/mcp-a2a` 以**单一共享账号**（`CONFER_USERNAME`/`CONFER_PASSWORD` 环境变量）运行，**没有** per-user OAuth / device-code 登录 / 签名密钥托管 / 多租户托管网关；一次安装 = 一个共享 Confer 账号。
> - `find_agents`/`list_agents` 只读 `/api/v1/contacts`（**已接受的联系人**）；**没有任何 scheduling 工具**（9 个已发布工具里零 schedule）。
> - 现有可复用的权限收件箱是**连接同意（connection-consent）收件箱**（`describePermission` 只渲染「X 请求连接」），方向是入站 peer-connect；**没有** errand 决策卡（approve / change-price / reject）。
> - `classifyPermissionLevel` 是字符串**前缀匹配**（L1 read / L3 payment+contract / L2 其余），可被措辞绕过，hostile 对端/网站的 prompt-injection 可重构 L3 动作 —— 内容审核只护 A2A peer 图，不护任意 web/email/phone 面。
> - 这些「未建」能力被明确排除在本探针 MVP 之外（见 §5 OUT）。

> **NON-FOUNDER GATE（不可移除，凡涉及验证处必现）：** 创始人用自己两个账号互发消息，只证明 **plumbing 通**，**不证明赌注成立**。成功只在 **≥2 个独立的、非创始人的真人**完成**非脚本化、有真实后果**的 Agent-to-Agent 来回时才计入。创始人双账号交换必须在所有成功计数中被**审计剔除**（C-E3）。本 PRD 所有出现「成功 / pass / 绿灯」的地方都受此 gate 约束。

---

## 2. 问题 / JTBD（基于 C 的 value 假设，含待验证反方）

### JTBD（正方，基于 C-v1）
开发者在 IDE 里写代码时，会反复撞上「只有某个**特定的人**知道答案」的时刻 —— 不是代码/库/repo 这类模型或文档能秒答的问题，而是**他人的隐性知识**：某个设计决策的真实意图、某个系统的 owner 是谁、某个凭证/访问权由谁掌握、某个领域专家的判断。今天他们只能 alt-tab 出 IDE，去 Slack 私聊那个人，等回复，再切回来。JTBD：**「不离开 IDE、不打断心流，就把这个只有特定真人能答的问题，交给那个人的 Agent 代答。」**

### Devil's-advocate（反方 —— 作为**待验证**，不是已知结论）

| 假设 | 反方质疑（必须被实验证伪或证实，不能默认任一方） |
|------|--------------------------------------------------|
| C-v1 | IDE 里的主导问题是代码/库/本地 repo —— 恰恰是基础模型 + 文档已经答得最好的领域。真正需要**另一个人**隐性知识的场景，往往在 Slack 上更快（人就在线、通知可靠）。现有工具 README 把 peer 定位成「coding resource」，正面撞上 host 模型的核心强项。 |
| C-v2 | 异步、可能 pending 的回复（`ask_agent` 阻塞 ~25s 后返回 pending，再 `check_reply` 轮询）会打断让 IDE Agent 有价值的紧反馈循环。一次 pending 体验就足以训练用户**永久弃用**这个工具。 |
| C-u2 | host 模型偏向用自己权重作答、偏好快/本地工具，很少会主动决定「我该去问 Alice 的 Agent」—— 工具沦为「按名手动调用」，「Agent 自动找 Agent」的魔法被侵蚀。 |

> 这三条反方在本探针里**不预设答案**：C-E1/C-E2 验证 C-v1；C-E2 的 Wizard 手动兜底回答规避 C-v2 的延迟干扰（让延迟不污染 desirability 信号）；C-u2 在 C-E1/C-E2 同一研究中**观测**「真实是否路由到问人 Agent」，不在探针里做路由工程。

---

## 3. 目标用户 + 反向用户

### 目标用户（探针招募对象）
- 每天使用 Claude Code 或 Cursor 的开发者（创始人网络 + 2-3 个 dev Slack/Discord 社区）。
- 有**真实可触达的人**可问：在 C-E2 里，每个 trial dev 预先种入 2-3 个**已同意做 relay 目标**的真实队友/同事。
- 工作中确有跨人隐性知识需求（设计意图、access owner、领域判断），而非纯代码问题。

### 反向用户 / Non-goals 用户（本探针明确**不**服务）
- **陌生人发现的需求方** —— 想「找不认识的人的 Agent」。本探针只在**已接受联系人 / 预种 relay 对**内运作（ground truth：`find_agents` 只读已接受联系人；陌生人目录与 consent-gate 的冲突是 C-f2/C-v3 的独立 design-spike，不在探针 MVP）。
- **要排程/预约的用户** —— 没有 scheduling 工具，不做（C-v3）。
- **要替自己对网站/邮件/电话采取行动的用户** —— 仓库无浏览器自动化 / SMTP / 电话，全是 greenfield，不做。
- **企业多租户/合规采购方** —— 没有 per-user OAuth、密钥托管、多租户网关（C-f1），探针不承诺这些。
- **创始人自己** —— 双账号自测**不计入**任何成功计数（NON-FOUNDER GATE / C-E3）。

---

## 4. 要 de-risk 的 leap-of-faith 假设（引用 C 的 leapOfFaith）

按 C 的 `leapOfFaith` 排名，本探针优先证伪/证实以下四条（desirability 在前，feasibility/distribution 在后）：

| Rank | 假设 ID | 类别 | impact/uncertainty | 一句话 | 对应实验 |
|------|---------|------|--------------------|--------|----------|
| 1 | **C-v1** | value | high / high | IDE 里存在「某个特定他人 Agent 比 web/RAG/问模型/Slack-DM 更优」的真实、复发的跨人任务 —— 全局赌注的本地实例。 | C-E1 → C-E2 |
| 2 | **C-g3** | gtm | medium / medium | 创始人自测是否是全局赌注的**有效代理** —— 元风险，决定本探针任何结果是否可解读。 | C-E3（前置 gate） |
| 3 | **C-vi1** | viability | high / high | 在已付 LLM+IDE 订阅之外，开发者/组织是否愿意为 in-IDE A2A 桥**付费**。 | C-E4 |
| 4 | **C-g1** | gtm | high / high | host marketplace 是否是低 CAC、自分发的真实漏斗（install→activation，受两边 contact 门限制）。 | C-E5 |

> 其余假设（C-f3 two-sided liveness、C-g2 seed graph、C-u1 setup 摩擦、C-f2/C-v3 陌生人发现 vs consent-gate、C-f1 多租户、C-v2 异步延迟、C-u2 工具选择、C-vi2 防御性）按 C 的 `rankedTestOrder` 排在探针之后或并行观测，**不**在本 MVP 里逐一构建去验证。

---

## 5. MVP 范围（IN）/ 明确不做（OUT）

> 本节是探针 MVP 的「构建-或-不构建」边界。原则：**复用已建，验证最便宜的假设；任何 ground-truth 里「未建」的能力一律排除。** 凡需「构建」的，只构建 Wizard-of-Oz 假门与埋点，不构建真实产品能力。

### IN（探针 MVP 构建/复用的）

| # | 范围项 | 说明 | 服务的假设/实验 |
|---|--------|------|------------------|
| IN-1 | **复用 `packages/mcp-a2a` 现有工具（零改动）** | `whoami` / `ask_agent` / `check_reply` / `follow_up` / `get_conversation` / `list_agents`（只读已接受联系人范围）等已建工具，单账号 env-var 配置照旧，**不**为探针改动其代码。 | C-E2（Wizard 真实工具注册载体） |
| IN-2 | **Wizard-of-Oz 工具 `ask_person_agent(person, question)`** | 真实 MCP 工具注册（让 host 模型可见可调），但答案由创始人**人工**触达被点名的真人并几分钟内转述回填（Wizard），让延迟不污染 desirability。**不**接真实 A2A 回调、**不**接 scheduling、**不**接陌生人发现。 | C-v1 / C-E2 |
| IN-3 | **预种 relay 对（已同意，已是联系人）** | 每个 trial dev 预先配 2-3 个**已同意**的真实队友作为可问对象（落在已接受联系人 / 预种范围内，**不碰**陌生人发现，因此不触 consent-gate 冲突）。 | C-E2 / C-g2 局部 |
| IN-4 | **全程 instrumentation（埋点）** | 记录每次调用：谁问、问题文本、模型本可独答否、是否同时开着 Slack-DM 备选；7 天内**无提示**的主动调用率。这是观测，不是产品功能。 | C-E1 / C-E2 / C-u2 观测 |
| IN-5 | **诊断日记 + 访谈协议（C-E1）** | 3 天轻量日记（每次 alt-tab 问人记一条 Slack-长度便条）+ 30 分钟访谈，把每条分类为「模型可解」vs「真·跨人隐性需求」。 | C-v1 / C-E1 |
| IN-6 | **非作者双人 pass/kill gate（C-E3，前置预注册）** | 在读任何 C-E2/C-E5 结果**之前**预注册规则；招募 6-8 对非创始人真人；审计剔除创始人双账号交换。 | C-g3 / C-E3 |
| IN-7 | **Fake-door 定价页（C-E4）** | landing + pricing：free（单联系人、env-var）vs Pro（**页面文案**写托管多租户、陌生人发现、优先回复）——**仅 fake door**：点击 Subscribe 捕获 email / Stripe checkout-intent，**不真实收费、不真实交付任何 Pro 能力**（这些能力本就未建）。 | C-vi1 / C-E4 |
| IN-8 | **Marketplace 上架 + 漏斗埋点（C-E5）** | 发布现有包到 Claude Code / Cursor MCP marketplace，端到端埋点 impression→install→register→招募并接受对端→首次成功 ask；零付费获客。上架的是**现有单账号包**，不为此新建多租户。 | C-g1 / C-E5 |

### OUT（探针**明确不做** —— 直接点名 ground-truth 里「未建」的部分）

| # | 不做项 | 为什么排除（ground truth） | 它属于哪个未来实验 |
|---|--------|---------------------------|---------------------|
| OUT-1 | **陌生人发现 / stranger discovery** | `find_agents`/`list_agents` 只读 `/api/v1/contacts`（已接受联系人）；把 public `.well-known` 目录接进 MCP 会重新引入 consent-gate 当初要挡的 spam/cold-outreach。开放发现 vs consent-gate 是**产品定义级冲突**，不是实现细节。 | C-f2 / C-v3（独立 design-spike，非探针） |
| OUT-2 | **Scheduling / 排程能力** | 9 个已发布工具里**零** schedule 工具；availability/proposal-counter/calendar-write 是一整个产品（calendar 读写仓库里也不存在）。headline「schedule with other people」是纯净的「未建」。 | 探针之外的 net-new 产品工作 |
| OUT-3 | **Multi-tenant OAuth / per-user 签名密钥托管 / 托管网关** | 今天签名留在 gateway、MCP 端只携带**单个**配置用户的 bearer token；一次安装 = 一个共享 Confer 账号。多租户自助需 OAuth/device-code、per-user 密钥下发、抗滥用托管网关 —— 是原型跳过的「贵的 80%」。 | C-f1（工程 spike，desirability 通过后才做） |
| OUT-4 | **真实异步延迟体验优化** | C-v2 的延迟容忍是独立 UX 阈值实验；本探针用 Wizard 人工兜底**刻意规避**延迟，使其不污染 desirability 信号。 | C-v2（latency-injection 原型，独立） |
| OUT-5 | **真实付费 / 真实 Pro 交付** | C-E4 是 fake-door，只测 view→paid-intent；不真扣款、不真交付 Pro（Pro 文案里的多租户/陌生人发现/优先回复本就未建）。 | —（fake door 本身即终点） |
| OUT-6 | **host 模型自动路由的工程优化** | C-u2（工具选择质量）只**观测**，不在探针里为「让模型更爱调用」做 prompt/工具描述工程。 | C-u2（观测，不构建） |
| OUT-7 | **内容审核 / autonomy red-team / 权限分级加固** | `classifyPermissionLevel` 的 prefix-matcher 缺口、prompt-injection 面是 Wave 2/3 安全门的事；探针不碰 L3/支付/合约动作，预种问答仅限低风险 read 级隐性知识。 | Wave 2/3 安全 gate |
| OUT-8 | **替人对网站/邮件/电话行动（telephony/SMTP/browser automation）** | 仓库完全没有这些能力，全是 greenfield 不可靠前沿。 | 探针之外的 greenfield，本 portfolio 暂不碰 |

---

## 6. 用户故事（含验收标准）

> 故事覆盖**探针执行**本身（招募者 / trial dev / 创始人-Wizard / 实验负责人），而非完整产品的终端形态 —— 因为本 PRD 的产物是「可解读的验证信号」，不是可售卖产品。

**US-1（trial dev · 心流内问人）**
> 作为一个在 Claude Code 里写代码的开发者，我想在不离开 IDE 的情况下，把「只有 Bob 知道的设计意图」交给 Bob 的 Agent，这样我不必 alt-tab 去 Slack 打断心流。
- **验收：** trial dev 在 IDE 内调用 `ask_person_agent("Bob", <问题>)`；工具真实注册并返回结果（结果由 Wizard 人工回填）；调用、问题文本、是否有 Slack-DM 备选被记录（IN-2/IN-4）。
- **验收：** 退出问卷中该 dev 能确认这是「我**不会**只问模型或 web 搜索」就能办的真实跨人任务（对齐 C-E2 successCriteria）。

**US-2（trial dev · 揭示性偏好，无提示）**
> 作为 trial dev，我在仅有一行 README、**无任何额外提示**的情况下，7 天内自发地为真实任务调用该工具至少一次。
- **验收：** 7 天内**无提示**主动调用率被埋点统计；分母为 trial dev 总数（C-E2）。
- **验收：** ≥25% 的 trial dev 至少为一个真实跨人任务调用一次（C-E2 successCriteria，不另造数字）。

**US-3（创始人-Wizard · 延迟去污染）**
> 作为 Wizard，我在几分钟内人工触达被点名的真人并转述其回答回填，使**延迟**不污染 desirability 信号。
- **验收：** 每个 ask 由创始人手动几分钟内兜底（IN-2）；该机制本身**不计入** C-v2 的延迟容忍结论（延迟容忍由独立的 C-v2 实验测，OUT-4）。
- **验收：** Wizard 回填的内容来自被点名的真人本人，**不是**创始人代答（否则即落回创始人自测，违反 NON-FOUNDER GATE）。

**US-4（实验负责人 · 非作者双人 gate，前置）**
> 作为实验负责人，我在读取任何 C-E2/C-E5 结果**之前**预注册规则：唯有 ≥2 个独立非创始人真人完成非脚本化、有后果的跨人来回才算 pass，并审计剔除创始人双账号交换。
- **验收：** 规则在任何 C-E2/C-E5 结果被读之前落档（C-E3 setup 第 1 步），落档为不可事后修改的 artifact（带时间戳）。
- **验收：** ≥50% 的非创始人 pair 完成 ≥1 次非脚本化、有后果、多轮（≥2 round-trip 且人真的据此行动）的交换；**且**有书面审计显示创始人双账号交换被排除（C-E3 successCriteria）。

**US-5（招募者 · 真实跨人需求诊断）**
> 作为招募者，我让 12-15 个每日用 Claude/Cursor 的 dev 记 3 天「alt-tab 问人」日记并访谈，把每条分类为「模型可解」vs「真·跨人隐性需求」。
- **验收：** 每条 tacit-need 记录都问清「实际怎么做的（Slack DM / 开会 / 放弃）」「换成问那人 Agent 是否更快」（C-E1 setup）。
- **验收：** 统计「报告 ≥1 条真实复发跨人需求」的参与者占比（C-E1 measurement）。

**US-6（增长负责人 · 自分发漏斗 + 招募对端）**
> 作为增长负责人，我把现有 MCP 包发布到 marketplace 并埋点 install→activation，特别标注「单人安装者是否成功招募到第二个真人配对」这个反自分发风险点。
- **验收：** 端到端漏斗埋点（impression→install→register→招募并接受对端→首次成功 ask），零付费获客（C-E5 setup）。
- **验收：** 显式标注「单人安装者招募到对端」的比例（C-E5 measurement）。

---

## 7. 成功指标 + 阈值（直接对齐 C-E1..C-E5 successCriteria，不另造数字）

| 实验 | 测什么 | 阈值（pass） | 来源 |
|------|--------|--------------|------|
| **C-E3**（前置 gate，对应 C-g3） | 非创始人 pair 完成非脚本化、有后果、多轮交换的比例 + 创始人剔除审计 | **≥50%** 的非创始人 pair 命中；**且**有书面审计显示创始人双账号交换被排除出所有成功计数 | C-E3 successCriteria |
| **C-E1**（对应 C-v1） | 报告 ≥1 条真实复发跨人隐性需求的参与者占比 | **≥40%**（如 15 人中 6 人）surface 此需求，**且**其中 ≥1/3 案例判定「问 Agent 比 Slack-DM 更快」 | C-E1 successCriteria |
| **C-E2**（对应 C-v1） | 7 天内**无提示**为真实跨人任务调用工具 ≥1 次的 trial dev 比例 | **≥25%** 的 trial dev 至少调用一次，且其在退出问卷确认这不是「只问模型/web 搜索」就能办的 | C-E2 successCriteria |
| **C-E4**（对应 C-vi1） | pricing-page view → paid-intent 转化率 | **≥8%** view-to-paid-intent，**且** 受访 5 家组织中 ≥2 家能点名一个 A2A 桥的可信预算 owner | C-E4 successCriteria |
| **C-E5**（对应 C-g1） | install→activation（7 天内：注册 + ≥1 已接受联系人 + ≥1 次成功 ask）+ 单人安装者招募到对端比例 | **≥15%** install 7 天内 activate，**且 ≥30%** 单人安装者成功招募到对端 —— 零付费获客 | C-E5 successCriteria |

> **指标保真说明：** 上表每个阈值均逐字对应 C-E1..C-E5 的 `successCriteria`，未引入任何 discovery 数据之外的数字。C-E1 的 timelineDays=9、C-E2=10、C-E3=5、C-E4=8、C-E5=28（4 周）来自各实验定义，作为 §9 执行节奏依据。

> **Wave 1 退出（综合 gate，对齐 §wave1.exitCriteria）：** C 通过的条件是 **≥2 个独立非创始人 pair 完成非脚本化、有后果的来回（创始人账号被审计剔除）AND ≥40% 的 C-E1 参与者 surface 了 agent-routing 优于 Slack-DM 的真实跨人需求**。任一不达 → **不**按设计资助 Wave 2，全局赌注存疑 —— pivot 或 kill。

---

## 8. 关键风险与依赖

| 风险 / 依赖 | 描述（ground truth） | 缓解 / gate |
|------------|----------------------|-------------|
| **非作者双人 gate（元风险，最高优先）** | 创始人双账号只证明 plumbing，不证明赌注。绿灯若来自自测即**假阳性**，会误导整个 portfolio（C-g3）。 | **C-E3 前置**：先预注册非创始人双人 pass/kill 规则，审计剔除创始人交换；C-E2/C-E5 的任何绿灯都受此 gate 校验。Wizard 回填必须来自被点名真人本人，禁止创始人代答（US-3 验收）。 |
| **Two-sided liveness（C-f3）** | 回复依赖**对端** Agent 在线且配置为自动回答 —— 早期几乎无对端在线，多数 ask 超时，会训练 host 模型和用户**弃用**工具，形成自我强化死循环。 | 探针用 **Wizard 人工兜底**（IN-2）规避 liveness 干扰 desirability；真实 liveness/seed-graph 由 C-f3/C-g2 的 seeded-pilot 单独测，**不**在本 MVP 内解决。 |
| **异步延迟容忍（C-v2）** | `ask_agent` 阻塞 ~25s 后返回 pending、再轮询 `check_reply`，可能打断 IDE 心流；一次 pending 即可致弃用。 | OUT-4：探针用 Wizard 几分钟兜底，使延迟不污染 desirability；C-v2 由独立 latency-injection 原型测。 |
| **host 工具选择（C-u2）** | 基础模型偏向自答、偏好快/本地工具，很少主动路由到「问某人 Agent」；随着用户装更多 MCP server 还会退化。 | 探针只**观测**揭示性偏好（IN-4，C-E2 无提示主动调用率），**不**做路由工程；若信号弱则判定需重做 trigger/surface（C-E2 decisionRule）。 |
| **开放发现 vs consent-gate 冲突（C-f2 / C-v3）** | headline「find other people / schedule」依赖把陌生人目录接进 MCP，直接撞 consent-gate（防 token-burning 入站）；二者按设计互斥。 | 探针**完全不碰**陌生人发现与排程（OUT-1/OUT-2）；该冲突留给独立 design-spike，不让它污染 desirability 探针。 |
| **权限分级可被绕过（C-f1 安全侧）** | `classifyPermissionLevel` 是前缀匹配，可被措辞绕过；hostile 对端 prompt-injection 可重构 L3 动作；审核只护 peer 图。 | 探针仅限**预种、已同意**对象间的**低风险 read 级**隐性知识问答（OUT-7），不触发 L3/支付/合约；加固留给 Wave 2/3 安全门。 |
| **付费/价值捕获（C-vi1）** | MCP server 普遍免费、近零变现先例；买方已付 Anthropic/Cursor，价值归属 host LLM session 而非桥，定价权弱、易被免费社区 clone 复制。 | C-E4 fake-door 先测意向，不真交付；fail → 视为 free-connector 成本中心，找组织级 wedge 或当 Wave-2 引流位，**不**当独立产品。 |
| **host 吸收 / 商品化（C-vi2，防御性）** | host（Anthropic/Cursor/OpenAI）可能原生发布「Agent 互联」，或 A2A + 新身份标准把 DID:web + RFC 9421 + AgentFacts 这层商品化；薄桥结构性弱势。 | 由竞品/标准 landscape desk-scan 处理（Wave 1 near-zero 成本搭车 B-E4/H-E1），在 desirability/viability 出正信号后才影响 build/no-build 决策。 |
| **依赖：预种 relay 对 + 已同意对象** | 探针 desirability 信号依赖每个 trial dev 有 2-3 个**已同意** relay 真人（IN-3），否则落入空图。 | 招募阶段强制预种；陌生人发现明确 OUT，避免把网络冷启动问题混进 desirability 测。 |
| **依赖：单账号 env-var 配置** | 当前一次安装 = 一个共享 Confer 账号（C-f1），探针沿用，不投入多租户。 | 多租户 OUT-3；仅在 C-v1/C-vi1/C-g1 出正信号后才做 C-f1 工程 spike。 |

---

## 9. 关联实验与决策门（Monday-ready 执行序列）

### 实验执行序列（引用 C 的 `sequence`）
```
C-E3  →  C-E1  →  C-E2  →  C-E4  →  C-E5
```

### 每个实验的「周一即可动手」清单（步骤 / 角色 / 产出 artifact / 工期）

| 实验 | 谁（角色） | 第一步具体动作 | 产出 artifact | 工期（来自定义） |
|------|-----------|----------------|---------------|------------------|
| **C-E3**（前置 gate） | 实验负责人 | 写下并落档（带时间戳、不可事后改）非创始人双人 pass/kill 规则 + 创始人剔除审计口径；从 C-E1/C-E2 池招 6-8 对非创始人 | 预注册规则文档 + pair 名单 + 审计模板 | 5 天 |
| **C-E1** | 招募者 | 招 12-15 个日用 Claude/Cursor 的 dev；下发 3 天日记模板 + 30 分钟访谈脚本 | 日记原始数据 + 分类编码表（模型可解 vs 跨人隐性） | 9 天 |
| **C-E2** | 创始人-Wizard + 实验负责人 | 向 8-12 个 trial dev 发布 `ask_person_agent` 假工具（真实注册）；每人预种 2-3 个已同意 relay 真人；上埋点 | 假工具 + 调用日志 + 退出问卷 | 10 天 |
| **C-E4** | 增长负责人 | 搭 landing+pricing（free vs Pro 文案）；接 Stripe checkout-intent（不收费）；从 marketplace/试用 cohort/社区帖引流 | 定价页 + 转化埋点 + 3-5 家组织预算 owner 访谈记录 | 8 天 |
| **C-E5** | 增长负责人 | 把现有单账号包上架 Claude Code / Cursor marketplace；端到端漏斗埋点；标注「单人招募到对端」 | marketplace listing + 漏斗仪表盘 | 28 天（4 周，周 cohort） |

### 每个实验的决策规则（引用 C 的 `decisionRule`）

| 实验 | pass → | fail → |
|------|--------|--------|
| **C-E3** | 自测是有效代理，C-E2/C-E5 的绿灯可解读 | C-E2/C-E5 的任何绿灯视为**假阳性**（plumbing 非赌注），作废这些结果，**不**据此探针 green-light portfolio，重设实验逼出独立真人证据 |
| **C-E1** | 跨人 JTBD 存在；推进 C-E2 测路由行为 | C-v1 被证伪（IDE 需求由模型/web/Slack 解决），**降级想法 C**，整个 A2A portfolio 拿到 desirability 红旗 —— 在任何 build 前升级上报 |
| **C-E2** | 揭示性偏好确认 dev 选择问人 Agent 优于替代；推进 C-E4 | 需求可能存在（C-E1）但在当下打不过 Slack-DM/模型 —— C-v1 视为**未验证**，重做 trigger/surface 再 build |
| **C-E4** | 在 host 订阅之外存在可捕获价值；推进 C-E5 | 是 free-connector 成本中心 —— 找组织级/价值捕获 wedge，或把 C 当 Wave-2 付费想法的引流 loss-leader，**不**当独立产品 |
| **C-E5** | host marketplace 是真实低 CAC 自分发漏斗；将 C 列为 Wave-1 base layer 并推进 B | 两边 contact 门杀死自分发（install 不 activate / 招不到对端）—— GTM pivot 到 seeded-cluster/社区销售，**放弃**「自分发」论点 |

### 关联决策门（引用 §gates）

| Gate | 与 C 的关系 |
|------|------------|
| **Wave 1 → Wave 2（全局赌注可解读门）** | **直接由 C 把守**：条件 = C 产出 ≥2 个独立非创始人 pair 完成非脚本化、有后果的来回（**创始人双账号被审计剔除**）AND ≥40% 的 C/B 受访者 surface 了「agent-routing 优于人-直连（Slack DM / 已知 API key）」的真实跨 owner 需求。pass → 资助 Wave 2（A、D）；fail → halt 网络依赖型想法；若「plumbing 通但无真实陌生人需求」→ pivot 到单机工具（G memory-as-a-service 是唯一网络无关对冲），并重新审视全局赌注是否错了。 |
| **Shared-economics gate（每个 wave 边界连续适用）** | 一旦 C 进入构建，须用 instrumented cost-to-serve 模型验证最重 20% 交互（**含人工兜底成本**）存在 margin-positive 价格带且 ≥10 个真实 prospect 接受；否则重新 scope 排除长尾重案，或从「business」降级为「feature」。 |

> **总原则：** 本 PRD 交付的是一个**可解读的验证信号**，不是一个可售卖的产品。C 的价值不在于「桥能用」，而在于它能以最低成本、在被 C-E3 净化过的前提下，告诉 portfolio：**真实、独立的人，是否愿意让 Agent 替自己跨人办事。** 凡探针涉及「构建」，只构建 Wizard-of-Oz 假门与埋点；凡 ground truth 标记「未建」的能力（陌生人发现 / 排程 / 多租户 OAuth / 替人对网站邮件电话行动 / 可靠权限分级），一律 OUT。
