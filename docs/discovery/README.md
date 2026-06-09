# Discovery — AI-Agent 协作产品

针对「AI Agent 代表各自主人互相通信、协作、办事」机会空间的产品发现产物。从 10 个想法的发散，到假设识别、Impact×Uncertainty 排序、实验设计，再到 Wave 1 的执行就绪启动包。

## 文档清单

| 文档 | 内容 | 何时读 |
|------|------|--------|
| [2026-06-09-agent-collaboration-discovery-plan.md](./2026-06-09-agent-collaboration-discovery-plan.md) | **探索计划总文档**：10 想法（A–J）· 123 假设（带 devil's-advocate）· 42 实验 · 跨想法综合（全局风险排序 / 5 共享假设 / 4 波时间线 / 4 决策门 / 5 kill signal） | 先读这份，建立全局 |
| [prd-C-mcp-a2a-bridge.md](./prd-C-mcp-a2a-bridge.md) | **想法 C 的 PRD** — Wave 1 最便宜探针 / 开发者入口（复用 `packages/mcp-a2a`）。MVP 范围明确排除 stranger discovery / scheduling / 多租户 | 决定第一个要建什么时 |
| [prd-A-delegate-assistant.md](./prd-A-delegate-assistant.md) | **想法 A 的 PRD** — Wave 2 杀手级应用锚点（个人对外委托助理 + 审批 inbox）。MVP 用 Wizard-of-Oz 起步，诚实标注"对人/对网站办事"为 greenfield | 规划 Wave 2 时 |
| [wave1-interview-guide.md](./wave1-interview-guide.md) | **访谈与日记研究脚本** — 覆盖 C-E1（跨人隐性知识日记+访谈）与 B-E1（counterparty 现实访谈）：筛选、逐字提问、反方探针、评分量规 | 开跑访谈前 |
| [wave1-metrics-instrumentation.md](./wave1-metrics-instrumentation.md) | **指标与埋点方案** — Wave 1 全部实验的主指标 / 预注册阈值 / 事件 schema / 非作者双人 gate 审计 / funnel / 单位经济埋点 / 决策仪表盘 | 上埋点前 |
| [wave1-runbook.md](./wave1-runbook.md) | **6 周执行 Runbook** — C-E3 预注册 gate 先行的甘特排期、owner、依赖、关键路径、Week 6 决策门、唯二需写代码的工程项边界 | 排日程、开跑 |

## 核心赌注（贯穿全部文档）

> **人们愿意让自己的 Agent 去和别人的 Agent / 外部世界往返办事，而不是自己亲自做。**

- **非作者双人 gate（硬规则）**：创始人自测只证明 plumbing 通，**不**证明赌注。成功只在 **≥2 个独立的非作者真人**完成非脚本化、有真实后果的 agent-to-agent 往返时才计入（C-E3 预注册，审计剔除创始人双账号）。
- **ground-truth 约束**：仓库当前**没有**电话 / 邮件发送 / 浏览器自动化；复用的 inbox 是连接同意而非事务决策卡；`classifyPermissionLevel` 是可被绕过的前缀匹配。所有 MVP 据此诚实划界。

## 执行顺序

想法构建/验证序：**C → B → A → D → H → G → J → F → E → I**（4 波）。

Wave 1 立即行动（见 runbook）：**C-E3 预注册 gate → C-E1 日记+访谈 → C-E2 Wizard-of-Oz → B-E1/B-E2(+B-E4/H-E1 商品化桌面扫描) → C-E4 fake-door 定价 → C-E5 marketplace 漏斗**，Week 6 走 Wave1→Wave2 决策门。

## 下一步建议

- 跑 Wave 1：按 runbook 从 C-E3 开始（唯二需写代码的是 C-E2 的 Wizard-of-Oz MCP 工具与 C-E5 的 marketplace 上架，边界见 runbook §6）。
- 实验出结果后回填本目录文档（living documents），按决策门推进 / 砍 / 转向。
