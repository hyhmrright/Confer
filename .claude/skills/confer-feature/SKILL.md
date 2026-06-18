---
name: confer-feature
description: Orchestrate end-to-end feature development on the Confer A2A platform with a 3-agent team (architect → implementer → reviewer-QA), following the project's explore→plan→implement→simplify→review→QA→deploy→commit workflow. Use whenever a feature/change request targets this codebase — building, adding, implementing, or changing behavior in gateway, client, identity, agent-runtime, conversation, shared, or the RAG pipeline. Also triggers for follow-ups: "再做一遍", "重跑", "更新", "改一下", "继续上次的", "基于之前结果", "只重做某部分". Plain questions and pure-docs edits do NOT need this — answer/handle directly.
---

用一个 3 人 agent 团队把 Confer 的功能需求跑完整开发流程。本编排器只定义「谁、何时、按什么顺序协作」；每个 agent「做什么、怎么做」在各自 `.claude/agents/*.md` 里。

**执行模式**：Agent 团队（实现者可在构建中实时向架构师/审查者提问）。
**团队（3 人）**：`confer-architect` → `confer-implementer` → `confer-reviewer-qa`。
**复用**：审查阶段按改动委派已有的 `a2a-contract-reviewer`、`migration-reviewer`；运维复用 `create-migration`、`deploy`、`rag-debug`、`sync-env` skill。
**所有 Agent 调用必须带 `model: "opus"`。**

## 数据传递

- **任务**：`TaskCreate`/`TaskUpdate` 跟踪各阶段状态与依赖
- **消息**：`SendMessage` 实时协调（澄清、退回修复、放行）
- **文件**：中间产物写 `_workspace/`，命名 `0N_{agent}_{artifact}.md`：
  - `01_architect_plan.md` · `02_implementer_changes.md` · `03_review_report.md`
- 最终产物=源码改动；`_workspace/` 保留供审计，不删除

## Phase 0：上下文确认（先做）

判定本次是初次 / 后续 / 部分重跑：

- `_workspace/` 不存在 → **初次执行**，走完整 Phase 1–4
- `_workspace/` 存在 + 用户要求改某部分 → **部分重跑**：只重新激活相关 agent（如「计划没问题但实现有 bug」→ 直接从 implementer 起）
- `_workspace/` 存在 + 用户给了全新需求 → **新执行**：把旧 `_workspace/` 移到 `_workspace_prev/` 再重来

## Phase 1：规划（confer-architect）

1. `TeamCreate` 组建 3 人团队（leader=编排器自身）
2. 调 `confer-architect` 探索代码库 + 读相关 `docs/`，产出 `_workspace/01_architect_plan.md`
3. 若计划含 `## 开放问题` 非空 → **暂停**，用 `AskUserQuestion` 向用户澄清后再继续（不擅自决定范围）

## Phase 2：实现（confer-implementer）

1. 调 `confer-implementer` 按计划「构建顺序」分包实现
2. 改 DB schema → implementer 用 `create-migration` skill，绝不手写 SQL
3. lint:fix + typecheck 由项目 hook 自动跑；hook 报错先修
4. 产出 `_workspace/02_implementer_changes.md`

## Phase 3：简化 + 审查 + QA（confer-reviewer-qa）

遵循全局工作流「写码 → 简化 → 审查」：

1. 简化：对本次改动跑 `agent-skills:code-simplification`
2. 调 `confer-reviewer-qa`：按改动类型委派 `a2a-contract-reviewer` / `migration-reviewer`，并做跨边界 QA（API 响应 shape ↔ client hook 逐字段比对）
3. 产出 `_workspace/03_review_report.md`，裁决 `PASS` / `NEEDS-FIX`
4. `NEEDS-FIX` → 退回 Phase 2 修复 → 复核（最多 2 轮；2 轮后仍有未决项，上报用户决断，不无限循环）

## Phase 4：部署 + 提交

审查 `PASS` 后，按全局工作流与项目部署规则：

1. **部署**（提交之前）：用 `deploy` skill 按改动的包重建并重启，确认 http://localhost/ 生效
2. **提交并推送到工作分支 `dev`（或从 `dev` 切出的 feature 分支）**（任务完成即触发，不再询问）；被分支保护拒绝则走 feature 分支 → `gh pr create --base dev` → `code-review:code-review <PR URL>`。`main` 是受保护的发布分支，仅在发布时由 `dev` 经 PR 合入（见 Release rules），随后从 `main` 打 tag
3. 提交信息按全局规则附 Co-Authored-By 行
4. 向用户汇报：做了什么、验证结果、是否已部署，并征询改进反馈（Phase 7 进化入口）

## 错误处理

- agent 失败：重试 1 次，再失败则带该阶段空结果继续并在汇报中显式标注缺失，不静默跳过
- 相冲突的信息：保留并标注出处，不删除
- 测试因环境（缺 seed/基础设施）失败：标为环境问题，不计为代码缺陷
- 范围超出 MVP v0.1：Phase 1 即暂停问用户，不擅自扩张

## 测试场景

- **正常流**：「给 consult 加一个超时自动取消」→ architect 定位 `routes/consult` + 计划 → implementer 改 gateway + schema（走 create-migration）→ reviewer 委派 a2a-contract-reviewer + migration-reviewer + 跨边界 QA → PASS → deploy gateway → 提交推送
- **错误流（NEEDS-FIX 循环）**：reviewer 发现 API 返回 `null` 而 client 未处理 → 退回 implementer 修 → 复核 PASS → 继续部署
- **部分重跑**：用户「计划对，但实现漏了 client 那边」→ Phase 0 判定部分重跑 → 从 implementer 起，跳过 architect
