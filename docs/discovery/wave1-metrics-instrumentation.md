# Wave 1 指标与埋点方案

> 适用范围：Wave 1（Weeks 1-6）全部实验 C-E1..C-E5 + B-E1..B-E4。
> 全局押注：「人们会让自己的 Agent 与他人 Agent 来回协作把事办成，而不是自己动手。」
> **非作者硬闸（贯穿全文，最高优先级）**：作者用自己两个账号自测**只证明「管线通」，不证明押注**。**只有 ≥2 名独立、非作者真人完成无脚本、有后果的跨人 Agent 往返才计成功（C-E3）。作者两账号的全部交换必须从每一处 success 计数中机械剔除，并产出可审计的剔除清单。** 本方案每一层埋点都必须能区分「作者自测」与「独立真人」；任何无法区分的计数，该实验的 green 一律判为可疑假阳性。
> **能力边界声明（ground truth，禁止逾越）**：当前代码库的出站能力 = 向对方 Agent HTTP 端点 POST 一条签名 A2A 消息（DID:web + RFC 9421）。**仓库内没有电话、没有 SMTP/邮件发送、没有浏览器自动化、没有调度工具、没有陌生人发现、没有多租户 OAuth/逐用户托管密钥、没有可靠的策略分类器**（`classifyPermissionLevel` 是可被措辞绕过的字符串前缀匹配）。本方案凡涉及上述能力的环节，一律以 **Wizard-of-Oz（作者人肉中转）/ greenfield（尚未构建）/ out-of-scope（探针外）** 显式标注，绝不假装产品已具备。Wave 1 是**探针，不是产品**；任何超出「便宜验证押注」的埋点都要砍掉。

---

## 0. 角色与产出物（Monday-ready）

埋点不靠工具自动产生时，由**人**按固定模板录入。下列角色为职责名（单人创业可一人多戴）。

| 角色 | 职责 | Wave 1 产出物 |
|------|------|--------------|
| **Founder/Operator** | C-E2 / B-E3 的 Wizard 人肉履约；招募；运行访谈 | Wizard 履约日志、访谈录音转写 |
| **Data steward** | 维护事件 schema、打标表、去重与非作者闸过滤；产出 `founder_exclusion_audit` | 三张打标表 + 仪表盘 + 审计清单 |
| **Reviewer（独立复核）** | 复核 C-E1/B-E1 打标的二分判定、复核 `model_could_answer` 与 `plumbing_echo`，防作者本人既当裁判又当选手 | 复核签字记录（双人对同一争议条目独立打标，分歧留痕） |

**Monday 启动清单（先后顺序固定）**：
1. Data steward 建三张打标表（§2.4）、四类事件表（§2.1-2.3）、`actor_identity` 表（§3.1）。
2. Founder 把自己控制的**全部**账号/DID 写入 `actor_identity` 并置 `is_founder_account=true`，**冻结并打时间戳**（在读取任何 C-E2/C-E5 结果之前——对应 C-E3 的「BEFORE any result is read」）。
3. 预注册各实验阈值（§1，逐字取自 successCriteria）+ C-E3 pass/kill 规则，时间戳登记，事后变更需留痕。
4. 仪表盘先点亮 §6.1 的「Non-founder gate 看板」骨架（此看板不绿，其余全部 provisional）。

产出物均为可审计文件/表，非口头。`.claude/peers/*` 不涉及；本方案的人读产出用 Markdown + CSV/SQL 表。

---

## 1. 指标体系总览

每个实验：唯一 PRIMARY 指标 + 预注册成功阈值（**逐字取自 successCriteria，未新造任何数字**）+ guardrail/反指标。

| 实验 | 测的假设 | PRIMARY 指标（唯一主指标） | 预注册成功阈值（逐字） | Guardrail / 反指标 |
|------|---------|---------------------------|----------------------|-------------------|
| **C-E1** 跨人隐性知识日记+访谈 | C-v1 | 参与者中「报告 ≥1 个真实、复发的跨人隐性知识需求（模型/web/RAG 解不了）」的占比 | ≥40% 参与者（如 15 人中 6 人）surface 出该需求 **AND** 其中 ≥1/3 的 case，agent-routing 被判定比直接 Slack-DM 真人「明显更快」 | 被错分为「跨人隐性」实为 code/library/repo（模型可解）的条目占比；复核后 tacit 条目里 >1/3 属模型可解 → 主指标虚高，重判 |
| **C-E2** WoZ「问队友的 Agent」工具 | C-v1 | 7 天内为真实跨人任务**主动**调用 `ask_person_agent` ≥1 次的 trial dev 占比 | ≥25% trial devs 至少调用 1 次，且 exit poll 确认该任务**不会**只去问模型或 web 搜索 | exit poll 自述「其实问模型/web 也能解」占比（伪需求）；novelty 调用（仅试玩、无真实任务）占比 |
| **C-E3** 非作者双人 pass/kill gate | C-g3 | 完成 ≥1 次无脚本、有后果、多轮 agent-to-agent 往返且真人据此行动的**非作者** pair 占比 | ≥50% 已 seed 的非作者 pair 达标 **AND** 有文档化审计证明作者两账号交换已从 C-E2/C-E5 所有 success 计数中剔除 | 判定为 plumbing-only echo 的往返占比；作者污染条目数（计入 success 必须为 0） |
| **C-E4** 付费定价 fake-door | C-vi1 | pricing-page view → 完成付费层意向（Stripe checkout-intent 或 card capture）的转化率 | ≥8% view-to-paid-intent **AND** 5 家受访 org 中 ≥2 家能指名一个 agent-to-agent bridge 的可信预算 owner | 付费点击后未完成 capture 的中途流失率；声明「expect free / 应免费」占比 |
| **C-E5** MCP marketplace install→activation | C-g1 | 7 天内 install→activated（注册 + 接受 1 个互相 contact + 完成 1 次 ask）占比 | ≥15% installs 在 7 天内 activate **AND** ≥30% solo installer 成功招募到 counterparty —— 且无付费获客 | solo installer 招募 counterparty 失败率（两边门是头号杀手）；任何付费 spend > $0 即 guardrail 失败 |
| **B-E1** 对手方现实问题访谈+流量审计 | B-v1 | 20 名受访中「报告当下真实跨信任边界 agent counterparty **AND** 指名可验证身份为首要 blocker」的人数 | ≥8/20（40%）报告真实跨 owner counterparty 且指名 identity 为首要 blocker；**AND** 所有被指名 blocker 中非身份类（capability/liability/output）占比 <50% | 非身份类 blocker 占比（≥50% 即结构性证伪）；intra-trust（自有工具/已知 API key）流量被误记为 cross-owner 的占比 |
| **B-E2** SDK landing + 5 行本地握手 smoke | B-g1 | 完成本地自签 sign→verify 握手的 unique visitor 占比（opt-in run-completion ping） | ≥25% CTA 点击率 **AND** ≥8% visitor 完成本地握手 **AND** ≥30% 完成者答「yes, would wire to a real peer」 | CTA 点击但握手完成率 ≪8% 的差额（说明「~5 行」是营销非现实）；onboarding 在 DID:web hosting / key mgmt 步的流失 |
| **B-E3** Concierge 单兵留存 | B-g1 | 14 天内**无作者提供对手方**下自驱完成 ≥1 次真实签名跨 agent 调用的 onboarded dev 占比 | ≥30% onboarded（约 12 人中 ≥4）14 天内自驱签名调用 **AND** 主流失原因是可修复摩擦**而非**「no one to call」 | drop-off 原因为「nothing to call / no peer」占比（若主导 → B-g1 证伪，自助是伪装的双边冷启动） |
| **B-E4** WTP smoke + 商品化/竞争扫描 | B-vi1 | pricing-step visitor 中「点击付费层 **AND** 给出真实支付/buy-call 信号（card entered 或 call booked）」占比 | ≥20% 点击付费层 **AND** ≥8% 给出硬支付信号 **AND** 扫描发现**没有**自带分发的免费 reference impl 已占据目标框架的身份槽 | 自述「expect free」占比；扫描命中「已 ship 的免费 native 身份/委派默认」（ownership window 关闭信号） |

> 所有 success 单元格中涉及人数/往返的计数，**必须先过 §3 非作者闸过滤**再统计。**C-E2 与 C-E5 的 green 在 C-E3 未 pass 前一律标记为 `provisional`，不得进入任何决策门。**

---

## 2. 事件埋点清单（event schema）

通用约定：所有事件携带公共属性 `event_id`(ULID)、`ts`(ISO8601)、`experiment_id`、`actor_id`（参与者稳定假名 ID）、`is_founder_account`(bool，见 §3)、`session_id`、`env`(`trial`/`prod`/`marketplace`)。属性命名 `snake_case`，外部输入用 Zod 校验，ID 用 ULID。**禁止记录 A2A 完整请求体（PII）**；message 文本只存哈希或人工打标后的分类标签，不存原文（见 §7）。

**作用域纪律**：能事件化的只有「本就存在于仓库的动作」——A2A 签名 ask、MCP 工具调用、landing/pricing 页面交互、RAG 读写。**电话/邮件/浏览器/调度/陌生人发现一律不事件化**（仓库没有这些表面）；C-E2 与 B-E3 的「跨人触达」由 Founder 人肉完成，只事件化「Wizard 履约」这一动作本身。

### 2.1 C-E2 — WoZ `ask_person_agent` 工具（重点，**显式 Wizard-of-Oz**）

WoZ 关键：工具是真注册的 MCP tool，但**答复由 Founder 人肉触达被点名真人并中转**（仓库无自动跨人路由，无调度）。预置的「可达真人」= 参与者自己**已同意**做中转目标的真实队友（对应仓库的 contact-consent 模型，**不是陌生人发现**）。埋点同时捕捉「主动调用」与「这是不是模型/web 本可解的需求」。

| 事件名 | 触发点 | 关键属性 |
|--------|--------|---------|
| `ce2_tool_registered` | trial dev 安装 stub 工具、首次 server boot | `actor_id`, `seeded_people[]`（**已同意**的预置可达真人，2-3 个）, `readme_version` |
| `ce2_tool_invoked` | dev 调用 `ask_person_agent(person, question)` | `target_person_id`, `question_hash`(SHA-256，不存原文), `question_topic_tag`（人工后标）, `model_could_answer`(enum yes/no/unsure，Reviewer 复核打), `had_slack_dm_alt_open`(bool), `is_unprompted`(bool，除一行 README 外无引导) |
| `ce2_wizard_fulfilled` | **Founder 人肉**触达被点名真人并回传答复 | `target_person_id`, `fulfill_latency_ms`, `relayed_by_founder`(bool，恒 true) |
| `ce2_reply_delivered` | 答复回到发起 dev 的 IDE | `invocation_event_id`（关联 invoke）, `round_trip_index` |
| `ce2_exit_poll` | 7 天结束 exit poll | `invocation_event_id`, `would_not_have_asked_model_or_web`(bool，**主指标分子的确认位**), `would_have_dm_human`(bool), `perceived_faster_than_dm`(bool) |

> 主指标分子 = `distinct actor_id`，其存在 ≥1 条 `ce2_tool_invoked{is_unprompted=true}` 且对应 `ce2_exit_poll{would_not_have_asked_model_or_web=true}`。分母 = 全部 trial devs（`ce2_tool_registered` distinct actor）。
> **作用域守卫**：本实验**不测延迟、不测自动化质量**——Founder 在分钟级人肉履约只为不让延迟混淆「是否愿意 route 给人的 Agent」这一**纯 desirability** 读数。`relayed_by_founder` 恒 true 是探针的特征，不是 bug。

### 2.2 C-E5 — marketplace install→activation funnel（重点）

每步一个事件，按 `actor_id` 串成漏斗。`acquisition_source` 区分 marketplace 自然量 vs organic post，**任何 paid source 都打 `paid=true`**，以便 guardrail 检验 CAC≈$0。**「接受互相 contact」走仓库现有的 contact-consent 闸，不是陌生人发现**；solo installer 招募第二个真人这一步是预注册的「single hardest step」。

| 事件名 | 漏斗步 | 关键属性 |
|--------|--------|---------|
| `ce5_marketplace_impression` | 0 曝光 | `acquisition_source`, `listing_version`, `paid`(bool) |
| `ce5_install` | 1 安装 | `acquisition_source`, `paid`, `client`(claude-code/cursor) |
| `ce5_server_boot_whoami` | 2 首次 boot（whoami） | `did`, `key_custody`(env-var/hosted) |
| `ce5_register` | 3 注册 | `actor_id`, `is_founder_account` |
| `ce5_recruit_invite_sent` | 4a 发起招募对手方 | `inviter_actor_id`, `invite_channel` |
| `ce5_counterparty_accepted` | 4b 互相 contact 接受（**两边门 / contact-consent**） | `inviter_actor_id`, `invitee_actor_id`, `both_independent`(bool，见 §3), `solo_installer_recruited`(bool) |
| `ce5_ask_sent` | 5a 发起一次 ask | `from_actor_id`, `to_actor_id`, `thread_id` |
| `ce5_ask_reply_success` | 5b 成功收到 ask 回复（activation 完成位） | `thread_id`, `round_trip_count` |

> `activated` = 同一 `actor_id` 满足 `ce5_register` + ≥1 `ce5_counterparty_accepted` + ≥1 `ce5_ask_reply_success`，且全程发生在 install 后 7 天内（`ce5_install.ts` 起算）。
> **现实校正**：当前 `packages/mcp-a2a` 以单一共享账号（env `CONFER_USERNAME/PASSWORD`）运行，**无逐用户 OAuth / 逐用户签名密钥托管 / 多租户网关**。要让两个独立真人各自有独立 `actor_id`，Wave 1 需 Founder 为每个安装者**手工配置独立账号凭据（concierge 配号）**——这是 greenfield，必须显式记为人工步，不可假装 marketplace 一键多租户。`key_custody` 字段如实记 `env-var`。

### 2.3 C-E4 / B-E2 / B-E4 — landing / pricing fake-door

页面与 stub 是**唯一新建的轻量物料**（landing 页 + 本地自签握手 stub + 价格页 fake-door）；不构建任何后端付费/托管，付费按钮即 fake door。

| 事件名 | 适用 | 关键属性 |
|--------|------|---------|
| `lp_page_view` | C-E4,B-E2,B-E4 | `page`(value-prop/pricing/landing), `visitor_id`（去重键，见 §7）, `referrer_channel` |
| `lp_cta_click` | B-E2(`Get install token`)，C-E4/B-E4(`Subscribe/Start paid`) | `cta_id`, `tier`(free/pro/team/enterprise) |
| `lp_paid_intent` | C-E4,B-E4 | `tier`, `signal_type`(stripe_checkout_intent/card_capture/call_booked), `is_hard_signal`(bool，card 或 booked call 才 true) |
| `lp_handshake_completed` | B-E2 | `visitor_id`, `run_completion_ping`(opt-in), `stub_version` |
| `lp_wire_intent` | B-E2 | `visitor_id`, `would_wire_real_peer`(bool) |
| `lp_pricing_response` | C-E4(VanWestendorp),B-E4 | `tier`, `expect_free`(bool), `wtp_open_text_hash` |

> **B-E2 的本地握手 stub 是 no-peer-network 自签 sign→verify**（仓库已有 RFC 9421 签名能力，本地自验不需要对方在线）——这是真实可跑的，**不需要任何陌生人发现或托管 DID 解析**，符合实验「testable without a network」设计。

### 2.4 纯定性实验的结构化打标字段（C-E1 / B-E1）

无可工具化事件，改为**逐条目/逐受访者结构化打标记录**，每条目一行，字段固定、可审计、可聚合。**二分判定由 Reviewer 独立复核**（防作者既当选手又当裁判）。

**C-E1 日记条目打标**（每个 alt-tab 出 IDE 的条目一行）：

| 字段 | 取值 | 说明 |
|------|------|------|
| `participant_id` | ULID | 参与者假名 |
| `entry_id` | ULID | |
| `need_class` | `model_solvable`(code/library/repo) / `cross_person_tacit`(decision-rationale/credentials-owner/domain-expert/who-owns-X) | 二分核心 |
| `tacit_subtype` | rationale/access-owner/domain-expert/ownership/null | |
| `is_recurring` | bool | 是否复发 |
| `actual_action` | slack_dm/meeting/gave_up/other | 实际做了什么 |
| `agent_routing_plausibly_faster` | bool | 主指标第二条件的判定位 |
| `reclassified_after_review` | bool | Reviewer 复核是否改判（反指标） |

> C-E1 主指标分子 = `distinct participant_id` 含 ≥1 条 `need_class=cross_person_tacit AND is_recurring=true`；附加条件 = 这些参与者里，其 tacit 条目中 `agent_routing_plausibly_faster=true` 占比 ≥1/3。

**B-E1 访谈打标**（每受访者一行）：

| 字段 | 取值 |
|------|------|
| `interviewee_id` | ULID |
| `counterparty_exists` | bool（当下真实跨 owner counterparty） |
| `traffic_class` | intra_trust / cross_owner（强制二分自报流量） |
| `primary_blocker` | identity / capability / liability / output_quality |
| `identity_named_as_primary` | bool |
| `would_pay_now` | bool |
| `blocker_rank_json` | identity vs capability vs liability vs output 的排序 |

> B-E1 主指标分子 = `count(counterparty_exists=true AND identity_named_as_primary=true)`；附加 guardrail = `所有 primary_blocker 中 identity 之外占比 < 50%`。

---

## 3. 非作者双人 gate 的审计埋点（C-E3）—— Wave 1 判读核心

目标：在**数据层**把「作者两账号交换」机械识别并从所有 success 计数中剔除，且留下可审计证据。这是整个 Wave 1 唯一能让其他 green 变得可解释的前置条件。

### 3.1 账号身份打标（注入源头）

每个 `actor_id` 在注册时绑定一条不可变身份记录 `actor_identity`：

| 字段 | 说明 |
|------|------|
| `actor_id` | ULID，稳定假名 |
| `is_founder_account` | bool。作者本人持有/控制的全部账号（含测试账号、备用 DID、concierge 为他人配的号若由作者代持也算）**预先登记**，在此置 true |
| `independence_class` | `founder` / `founder_relay_seed`（作者预置、本人已同意的可达真人，本身可参与，但作者不得同时占 pair 两端） / `independent` |
| `recruited_by_actor_id` | 谁招募来的（追溯是否被作者直接拉来占两端） |
| `device_fingerprint_hash` | 设备/IP/key 指纹哈希（辅助识别同一人多账号，见 §7） |

> 作者账号清单在 Wave 1 启动前**预注册并冻结**（pre-register，带时间戳），新增需带时间戳与理由，事后不可回填——对应 C-E3 的「BEFORE any C-E2/C-E5 result is read」。

### 3.2 每次往返/exchange 的 pair 级判定字段

每一条被计入 success 候选的 exchange（C-E2 invocation、C-E5 ask、C-E3 pair 往返）打：

| 字段 | 取值 | 用途 |
|------|------|------|
| `exchange_id` | ULID | |
| `pair_actor_a` / `pair_actor_b` | actor_id | 两端 |
| `both_independent` | bool = `(a.is_founder_account=false AND b.is_founder_account=false)` | **success 计数的硬过滤位** |
| `founder_contaminated` | bool = `(a.is_founder_account OR b.is_founder_account)` | 反指标计数 |
| `is_unscripted` | bool | 参与者自有任务，非作者脚本（可审计：任务来源登记） |
| `is_consequential` | bool | 真人据此行动（schedule/decision/acted-on，留 outcome 证据链接） |
| `round_trip_count` | int | ≥2 才算多轮 |
| `agent_answered_on_behalf` | bool | 接收方 Agent 代答 vs 真人手动介入（区分真委派 vs 真人接管） |
| `plumbing_echo` | bool | Reviewer 判定为管线回声（无真实信息交换） |

### 3.3 success 计数规则（数据层 SQL 语义）

```
qualified_exchange := both_independent = true
                      AND is_unscripted = true
                      AND is_consequential = true
                      AND round_trip_count >= 2
                      AND plumbing_echo = false
```

- **C-E3 分子** = `distinct pair` 含 ≥1 条 `qualified_exchange`；分母 = 已 seed 的非作者 pair 数。**阈值 ≥50%**（逐字）。
- **C-E2 / C-E5 的任何 success 计数**在聚合时强制 `WHERE both_independent = true`；`founder_contaminated = true` 的行单列入「审计剔除表」并产出 `founder_exclusion_audit`（被剔除 exchange 列表 + 数量），即 C-E3 successCriteria 第二条「documented audit shows the founder's own two-account exchanges were excluded」。
- **「≥2 名独立非作者真人」是硬下限**：即便比例达标，若 `distinct independent actor across qualified pairs < 2`，C-E3 不得判 pass——比例不能掩盖样本里其实只有作者自己。
- 仪表盘必须同时显示「含作者」与「剔除作者后」两个数，二者差距即污染规模。

---

## 4. Funnel 与转化定义（C-E5）

完整链路 install → activation（含招募 counterparty）→ 完成一次跨人往返，每步定义、分母、流失计算。**所有转化率默认在 `both_independent = true` 且去重后计算**（§3、§7）。

| # | 步骤 | 进入事件 | 完成定义 | 流失（drop = 1 − step_conversion） |
|---|------|---------|---------|-----------------------------------|
| S0 | 曝光 | `ce5_marketplace_impression` | — | 漏斗起点（仅监控，不入主指标分母） |
| S1 | 安装 | `ce5_install` | server 首次 boot `ce5_server_boot_whoami` | S1→S2 流失 = 装了不 boot |
| S2 | 注册 | `ce5_server_boot_whoami` | `ce5_register` | boot 不注册流失 |
| S3 | 招募对手方（两边门 / contact-consent，**最难步**） | `ce5_register` | `ce5_counterparty_accepted{both_independent=true}` | **关键流失**：solo installer 招不到第二个真人。单列 `recruit_drop_rate` |
| S4 | 完成一次 ask 往返 | `ce5_counterparty_accepted` | `ce5_ask_reply_success` | 有 contact 但从未成功 ask |

派生指标：
- **install→activation（主指标）** = `distinct actor with (register + counterparty_accepted + ask_reply_success) within 7d` / `distinct ce5_install（仅 independent）`。阈值 **≥15%**。
- **solo-installer recruit 率** = `count(ce5_counterparty_accepted where inviter is solo installer AND invitee independent)` / `count(solo installers who reached S2)`。阈值 **≥30%**。
- **S3 是预注册的「single hardest step」**：单独看板高亮；activation 失败时必须能区分是 S3（招不到人，两边门杀）还是 S4（招到人但 ask 不通，产品问题）——对应 C-E5 decisionRule 的两条分叉。
- 7 天窗口按每个 `actor_id` 的 `ce5_install.ts` 各自起算（rolling cohort，weekly 入组，跑 4 周）。
- **Greenfield 注脚**：S2「注册为独立 actor」当前需 concierge 手工配号（无多租户 OAuth），该人工步计入 §0 Founder 工时，**不计为产品已具备的自助能力**。

---

## 5. 单位经济埋点（cost-to-serve 基线，为 Wave-2 A-EXP3 打底）

对应 shared assumption「每次 consequential errand/quote/answer/recall 烧 LLM 推理循环 + browser/telephony/embedding/human-fallback 成本，且最高 WTP 的重度用户最贵」。**Wave 1 没有真实自主行动、没有浏览器/电话成本**（仓库无这些表面）；**唯一真实的 human-fallback 成本就是 C-E2 的 Founder 人肉 Wizard 履约时长**。现在只为每次 Wizard 履约 / 每次 A2A ask / 每次 RAG 操作建**基线表**，供 Wave-2 复用。**Wave 1 只建基线，不下任何经济结论。**

每次可计费交互记一条 `cost_to_serve` 事件：

| 字段 | 说明 |
|------|------|
| `interaction_id` | ULID，关联到具体 ask/invocation/exchange |
| `interaction_type` | wizard_fulfill / a2a_ask / rag_write / rag_recall |
| `llm_input_tokens` / `llm_output_tokens` | LLM 推理 token |
| `llm_loop_count` | reasoning loop / retry 次数 |
| `retry_count` | 失败重试次数 |
| `embedding_tokens` | RAG write/recall 的 embedding 成本 |
| `vector_search_count` | recall 触发的向量检索次数 |
| `human_fallback_seconds` | 人肉兜底耗时；Wave 1 = `ce2_wizard_fulfilled.fulfill_latency_ms` 折算的 Founder 人工分钟，**这是 Wave-1 唯一真实 human-fallback 成本**；`browser_seconds`/`telephony_seconds` 字段**保留为空**（greenfield，无来源） |
| `est_cost_usd` | 按单价折算的本次估算成本 |
| `actor_wtp_band` | 该用户在 C-E4/B-E4 表达的 WTP 档（交叉验证「最高 WTP=最贵」是否成立） |

> 派生：按 `actor_wtp_band` 分组看 `est_cost_usd` 分布，重点看**最重 20%** interaction 的 cost-to-serve（A-EXP3 / G-E3 口径）。Wave 1 仅供 Wave-2 的 shared-economics gate 复用，本波不判定。

---

## 6. 仪表盘与判定

### 6.1 看板分组

1. **Non-founder gate 看板（最高优先级，先看）**：C-E3 合格 pair 数、**独立非作者真人去重计数（硬下限 ≥2）**、污染 exchange 数、`founder_exclusion_audit` 是否产出。**此看板不绿，下面全部 provisional。**
2. **C 需求看板**：C-E1 主指标 + C-E2 主指标（仅 `both_independent`）。
3. **C 分发/付费看板**：C-E5 漏斗（S1–S4 + recruit 率）、C-E4 paid-intent。
4. **B 基础层看板**：B-E1 身份 blocker 占比、B-E2 握手完成率、B-E3 14 天留存 + drop-off 原因分布、B-E4 paid-intent + 商品化扫描结论。
5. **单位经济基线看板**：§5 cost-to-serve 分布（基线，不判定）。

### 6.2 决策门判定（对应数据中的 gates 与 killSignals）

| 决策门 | 看哪些指标 | PASS | FAIL / PIVOT |
|--------|-----------|------|--------------|
| **C-E3 非作者闸（前置，最先判）** | C-E3 主指标 + 独立真人去重 ≥2 + `founder_exclusion_audit` | ≥50% 非作者 pair 出 `qualified_exchange` **AND** 独立非作者真人 ≥2 **AND** 审计文档已剔除作者两账号 | FAIL → C-E2/C-E5 所有 green 判为 **likely false positive（plumbing）**，作废这些结果，**不得**据此 green-light portfolio，重设实验强制独立真人证据 |
| **Wave1→Wave2（全局押注可解释闸）** | C-E3（≥2 独立非作者 pair）+ C-E1/B-E1 跨 owner 需求占比 | C 产出 ≥2 独立非作者 pair 完成无脚本有后果往返（作者审计剔除）**AND** ≥40% C/B 受访 surface 出 agent-routing 胜过真人直连的跨 owner 需求 | FAIL → 暂停所有依赖网络的 idea。「管线通但无真实陌生人需求」→ 退守单机工具（G 是唯一网络无关 hedge），重审押注是否错；仅 B 身份痛失败而 C 需求成立 → 丢掉付费基础设施论（B/H/F），保留应用路径（A/D/J） |
| **C-E1 自身决策** | C-E1 主指标 | ≥40% 参与者出真实复发跨人 tacit 需求 **AND** 其中 ≥1/3 agent-routing 更快 | FAIL → A-v1 证伪（IDE 需求 model/web/Slack 可解），降权 idea C，**整个 portfolio 触发 desirability 红旗，build 前升级上报** |
| **C-E2 自身决策** | C-E2 主指标（独立账号） | ≥25% trial dev 为真实任务调用且 exit poll 确认非模型/web 可解 | FAIL → 需求或在（C-E1）但当下打不过 Slack-DM/模型，A-v1 视为 not-yet-validated，build 前重做 trigger/surface |
| **C-E4 自身决策** | paid-intent + org 预算 owner | ≥8% view→paid-intent **AND** ≥2/5 org 指名预算 owner | FAIL → 是免费连接器/成本中心，找 org 价值捕获 wedge，或把 C 当 Wave-2 付费 idea 的引流 loss-leader |
| **C-E5 自身决策** | 漏斗 + recruit 率 + `paid=0` guardrail | ≥15% activate **AND** ≥30% solo installer 招到对手方 **AND** 无付费 spend | FAIL（两边门杀自分发）→ GTM 转 seeded-cluster/社区销售，丢掉「self-distributing」论 |
| **B-E1 自身决策** | 身份 blocker 占比 | ≥8/20 报告跨 owner counterparty 且指名 identity **AND** 非身份 blocker <50% | FAIL 因流量压倒性 intra-trust → SDK 是无市场的解，停 B，先建跨 owner 网络（A/D）；FAIL 因 blocker 真但非 identity → wedge 转向被指名 blocker 再 build |
| **B-E2 自身决策** | 握手完成率 + wire 意向 | ≥25% CTA **AND** ≥8% 完成握手 **AND** ≥30% 完成者愿 wire 真 peer | CTA 过但握手 ≪8% → 「~5 行」是营销，先修 onboarding（DID:web hosting/key mgmt）；两者皆败 → 自助 aha 弱，B 的 Wave-1 优先级降到 C 之后 |
| **B-E3 自身决策** | 14 天留存 + drop-off 原因 | ≥30% onboarded 自驱签名调用 **AND** 主流失=可修复摩擦 | FAIL 且主流失=「nothing to call/no peer」→ B-g1 证伪，自助是伪装双边冷启动，先建网络（A/D）、B 作其下层基础设施；仅可修复摩擦失败 → 修 onboarding 重跑一次 |
| **B-E4 自身决策** | paid-intent + 商品化扫描 | ≥20% 点付费 **AND** ≥8% 硬支付信号 **AND** 扫描无已 ship 的免费分发型 reference impl 占身份槽 | WTP 过但扫描发现已 ship 的 blessed 免费 impl → 槽在关闭，B 重定位为免费标准上的薄增值（analytics/policy）；WTP 败（期望免费）→ B-vi1 证伪，B 是 feature 非 business，折进付费产品（A/J） |
| **Shared-economics 闸（每个 wave 边界持续）** | §5 最重 20% interaction 的 cost-to-serve vs 可接受价带 | 重度 20% 上存在 ≥10 真实 prospect 接受的 margin-positive 价带（含 human-fallback） | FAIL → 缩 offer 排除长尾重度 case 或改 key 模型（BYO vs supplied）后再 scale；无 re-scope 转正 → 从 business 降为 feature，停独立投入。**注：Wave 1 仅积累基线，此闸在 Wave-2 边界才首次实判** |

### 6.3 Kill signal 数据触发（直接挂到埋点）

| Kill signal | 数据触发条件 |
|-------------|-------------|
| 非作者双人闸过不去 | C/A/I 跨实验：`distinct pair with qualified_exchange (both_independent)` 反复 = 0 或 `distinct independent actor < 2`，只有 `founder_contaminated` 行 → 杀掉除 G 外所有依赖 counterparty 的 idea |
| 有杠杆/信息优势方系统性拒绝 | C-E2/后续 A/E/I：`agent_answered_on_behalf=false` 在高 stakes 任务上系统性偏高（真人接管），仅低值/commodity 交互接受委派 → 转 agent-assisted（human-in-loop，agent 起草/真人发送）模型 |
| 灾难性自主失败（不可逆） | 任一 live concierge / 红队：出现 off-boundary 花钱/法律承诺动作（hostile listing 的 prompt-injection 把 L3 动作绕过可被措辞欺骗的 prefix-matcher）→ **单次即停**所有真实世界动作 idea（A/J/E/I）直至 containment 证明。**注：Wave 1 无自主行动表面，此信号在 Wave-2 才可能触发；但 §7 已要求记录任何越界尝试** |
| Ownership window 关闭 | B-E4/H-E1 扫描命中「hyperscaler/模型框架 owner 已 ship 免费 native 的 agent identity/delegation/trust scoring 默认」→ 同时杀 B/H/F 基础设施变现主线，转做 incumbent 标准之上的应用 |
| 单位经济倒挂 | §5（**Wave-2 起判**）：跨 A/D/G 最高 WTP 的重度用户结构性最亏，且无 re-scope 产生真实 prospect 接受的 margin-positive 价带 → 杀掉或降级为 feature |

---

## 7. 数据质量与防作弊

| 风险 | 机制 |
|------|------|
| **Self-test 污染（头号风险）** | 作者全部账号 Wave-1 启动前**预注册并冻结** `is_founder_account=true`（§3.1）；所有 success 聚合强制 `both_independent=true`；产出 `founder_exclusion_audit` 列出被剔除 exchange；**额外硬下限：合格 pair 中独立非作者真人去重 ≥2**。设备/IP/signing-key 指纹哈希交叉比对，识别「作者用未登记新账号扮独立人」——同指纹跨号即标 `suspected_founder_alt` 交 Reviewer 复核。**concierge 为他人配号时，凭据若由作者代持必须标 founder**，直到真人本人接管控制权 |
| **裁判=选手污染** | C-E1/B-E1 的二分判定、`model_could_answer`、`plumbing_echo`、`is_consequential` 由 **Reviewer（非履约 Founder）独立复核**；争议条目双人独立打标、分歧留痕，杜绝作者既履约又自评为 success |
| **去重** | landing/install 以 `visitor_id`（first-party cookie + 标准化 IP/UA 哈希）为去重键；同 `actor_id` 多次 install 只计首次；漏斗按 `distinct actor_id` 计，不按事件计 |
| **Bot / 爬虫** | landing 事件过滤已知 bot UA + 无 JS 执行的请求；`lp_handshake_completed` 依赖 opt-in run-completion ping（需真实跑 stub），天然抗刷；marketplace impression 仅作监控不入主指标分母 |
| **WoZ novelty 调用** | C-E2 区分 `is_unprompted` 与 novelty：仅当对应 `ce2_exit_poll.would_not_have_asked_model_or_web=true` 才计入主指标分子，排除「纯试玩」 |
| **Plumbing echo（管线回声冒充委派）** | 每 exchange 打 `plumbing_echo` + `is_consequential`（需 outcome 证据链接）+ `round_trip_count>=2`，三者全过才算 `qualified_exchange`，挡住「两账号互 ping」假成功 |
| **Pricing fake-door 注水** | `lp_paid_intent` 只把 card_capture / booked_call 计为 `is_hard_signal`；soft 点击与 hard 信号分开报，阈值（C-E4 ≥8% paid-intent、B-E4 ≥8% 硬信号）按各自口径分别核 |
| **CAC≈$0 主张守护** | C-E5 任何 `paid=true` 的 acquisition_source 都打标；一旦付费 spend>$0，guardrail 直接判 C-E5「self-distributing」主张失败，无论 activation 率多高 |
| **越界动作留痕（为 Wave-2 红队预埋）** | Wave 1 虽无自主行动表面，但任何 ask 内容若试图诱导越界（要求花钱/法律承诺/绕过权限），由 Reviewer 标 `off_boundary_attempt` 留证，供 Wave-2 prefix-matcher 缺陷与 prompt-injection 面分析复用 |
| **PII / 合约不破坏** | 不记 A2A 完整请求体；message 只存 `*_hash` 或人工分类标签；遵守 DID 文档缓存 TTL/ETag；身份字段用假名 ID，原始 PII 不入分析库 |
| **预注册防 p-hacking** | C-E3 的 pass/kill 规则、各实验阈值、作者账号清单，均在读取任何 C-E2/C-E5 结果**之前**冻结时间戳登记，事后阈值变更需留痕——对应 C-E3「pre-register BEFORE any result is read」 |

---

*口径锁定声明*：本方案所有成功阈值逐字取自各实验 successCriteria，未新增指标或阈值。所有跨人「成功」计数一律先过非作者闸（§3）：作者两账号交换在每一处 success 统计中审计剔除，且合格 pair 中独立非作者真人去重需 ≥2。C-E2 与 C-E5 的任何 green 在 C-E3 通过前标记为 provisional，不进入 Wave1→Wave2 决策门。**能力边界**：本方案不假设仓库具备电话/邮件/浏览器自动化/调度/陌生人发现/多租户 OAuth/可靠策略分类器——凡涉处一律以 Wizard-of-Oz（Founder 人肉）/ greenfield（人工 concierge 步）/ out-of-scope（Wave-2 起判）显式标注。Wave 1 是便宜探针，不是产品。
