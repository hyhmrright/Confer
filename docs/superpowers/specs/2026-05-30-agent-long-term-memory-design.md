# Agent 长期记忆设计（Mem0 架构 + Confer 原生实现）

- 日期：2026-05-30
- 状态：已批准设计，待实现
- 范围：MVP 增强 —— 让 Confer 的 agent 跨对话记住用户的持久事实

## 1. 背景与目标

Confer 当前的 agent 只有「单对话内最近 20 条消息」这一层短期上下文（`stream.ts:100-111`），跨对话不记得任何东西。`agent_memories` 表只是用户**手动**录入的笔记，不会自动抽取、也不注入对话。

目标：引入**自动的、跨对话的长期记忆**，让系统更好用 —— agent 能记住用户的偏好、身份、目标、长期项目，并在后续对话中自然地用上。

### 选型结论

经深度调研（Mem0 / Zep-Graphiti / Letta / Cognee / MemoryOS 等）后，确定**采用 Mem0 的记忆架构，但用 Confer 已跑通的基础设施原生实现**，而非引入 Mem0 的包或独立服务。

决定性原因：**Confer 是多用户系统，每个用户用自己的 AI（LLM/embedding key 加密存 DB，per-user）**。而 Mem0 的 LLM/embedding key 是「实例级」配置，独立 Mem0 server 全服务只能用一套全局 key，无法做 per-user key，与本约束直接冲突。要 per-user key 就只能在 gateway 进程内为每用户构造实例（`mem0ai/oss` TS SDK），但该 TS SDK 对 Qdrant、GLM/Qwen 的支持未经证实。

而 Mem0 的记忆「配方」本身（LLM 抽事实 → embed → 向量库去重 upsert → 语义召回）所需的每一个零件，Confer 都已经有且跑通：`createProvider`（多 provider LLM）、`lib/embedding.ts`（多 provider embedding，已支持 OpenAI/GLM/Qwen）、`lib/qdrant.ts`（向量库）、per-user 加密 key 解密链路。复用它们零新基础设施、零依赖赌注。

### 已锁定的设计决策

| 维度 | 决定 |
|---|---|
| 落地方案 | 采用 Mem0 记忆架构，复用 Confer 现有基础设施 |
| 写入时机 | 每轮对话后异步抽取（fire-and-forget） |
| 读取方式 | 自动注入 system prompt |
| 隔离粒度 | 按 user_id |
| key 来源 | 用户当前对话所用的 provider/key（per-user） |

## 2. 整体架构

```
┌─ 写入（每轮对话后，异步，fire-and-forget）──────────────┐
│ user 消息 + agent 回复（+最近几条历史）                  │
│   → LLM 抽事实（用户自己的 provider/key，createProvider）│
│   → 原子事实数组 ["用户在做 A2A 项目", "偏好 TypeScript"]│
│   → embed（用户的 embedding key/provider，embedding.ts） │
│   → 去重：search top1 相似记忆，cosine≥0.85 则跳过(NOOP) │
│   → upsert 到 Qdrant + insert 到 Postgres                │
└──────────────────────────────────────────────────────────┘
┌─ 读取（每次回复前，同步）───────────────────────────────┐
│ 当前 user 消息 → embed → search top-K（user_id 过滤）   │
│   → 拼进 system prompt:"关于该用户你已知道:…"           │
└──────────────────────────────────────────────────────────┘
```

没配 LLM/embedding key 的用户：写入与读取均**静默跳过**（与知识库 KB 完全一致的优雅降级）。

## 3. 组件拆分

一个文件一个职责，镜像现有 KB RAG 的结构。

### 新增文件

| 文件 | 职责 | 类比 |
|---|---|---|
| `gateway/src/lib/memory-store.ts` | Qdrant 记忆向量层：`upsertMemory` / `searchMemories` / `deleteMemory`；collection = `agent_memories_vec` | `lib/qdrant.ts` |
| `gateway/src/lib/memory-extract.ts` | 用 LLM 从对话抽原子事实（给定 provider+key，返回 `string[]`），含抽取 prompt | Mem0 配方核心（新逻辑） |
| `gateway/src/tools/memory.ts` | 编排：`extractAndStore`（写入循环+去重）、`recallMemories`（召回并返回拼好的 prompt 片段） | `tools/knowledge-base.ts` |

### 复用，不修改

- `lib/embedding.ts` —— `embedTexts(texts, key, provider)`，多 provider。
- `agent-runtime` 的 `createProvider(name, key)` —— 抽事实的 LLM 调用。
- `lib/qdrant.ts` 的 `toUUID` —— ULID→UUID 转换（Qdrant point id 要求）。

### 修改文件

- `gateway/src/routes/stream.ts`：
  - 构造 system prompt 前调用 `recallMemories`，将召回结果附加到 system prompt。
  - `done` 事件发出后 fire-and-forget 调用 `extractAndStore`。
- `gateway/src/db/schema.ts`：`agent_memories` 表新增 `source` 列。
- `gateway/src/routes/memories.ts`：列表查询保持兼容（自动记忆与手动笔记统一展示）。

## 4. 存储设计（双写）

### Qdrant：`agent_memories_vec` collection

- 向量维度 1536（与现有 embedding 对齐）、Cosine 距离。
- payload：`{ user_id, memory_id, text, created_at }`。
- point id：`toUUID(memory_id)`。
- 职责：语义召回、去重判定。

### Postgres：复用现有 `agent_memories` 表

自动抽取的记忆即往该表插行，与用户手动笔记统一：

- `content` = 事实文本；`title` = 事实前段（截断）。
- 新增列 `source varchar(16) default 'manual'`：区分 `manual`（用户手填）/ `auto`（自动抽取）。
- `id`（ULID）即作为 Qdrant payload 的 `memory_id` 关联键。
- 职责：可列出、可管理、可删除；前端 MemoryPage 几乎不用改即可展示。

**双写理由**：Qdrant 管「语义找得到」，Postgres 管「列得出/可管理/可删」。删除时按 `memory_id` 两边一起删。

### Migration

给 `agent_memories` 加 `source` 列，**走 `bun run db:generate`**（绝不手写 SQL —— 见 CLAUDE.md pitfall：手写 migration 导致 journal 不同步曾出过事故）。

## 5. 数据流细节

### 写入（`extractAndStore`，stream.ts `done` 后 fire-and-forget）

1. 取本轮 `user 消息 + agent 回复`丢给 LLM 抽事实（用户的 provider/key）。MVP 仅用当前轮，不附历史（省 token；后续可扩展）。
2. 抽取 prompt 要求输出 JSON 数组，只抽**关于用户的持久事实**（偏好/身份/目标/长期项目），忽略一次性闲聊。空数组直接返回。
3. 对每条事实 embed → Qdrant `searchMemories(top1, user_id)`：
   - cosine ≥ **0.85**（去重阈值）→ 判为已知，**跳过**（NOOP）。
   - 否则 → `upsertMemory`（Qdrant）+ insert（`agent_memories`，`source='auto'`）。

### 读取（`recallMemories`，stream.ts 构造 system prompt 前）

- 当前 user 消息 embed → `searchMemories(top-K=5, user_id, score≥0.3)`。
- 拼成：`\n关于该用户你已知道:\n- 事实1\n- 事实2` 附到 system prompt 尾部。
- 无命中则不追加任何内容。

### 配置默认值

| 项 | 默认 |
|---|---|
| 去重阈值（cosine） | 0.85 |
| 召回 top-K | 5 |
| 召回最低 score | 0.3 |
| 抽取用的 provider/key | 用户当前对话所用的同一个 |

## 6. 错误处理

吸取此前 KB retry 的教训（silent failure / buffer 问题）：

- 写入是 fire-and-forget，**整条抽取链路包在 try/catch，失败只 `console.error`，绝不影响对话**（记忆是增强项，不能拖垮回复）。
- 没配 LLM/embedding key 的用户：抽取与召回都**静默跳过**（与 KB 一致）。
- 读取失败也 catch，降级为「无记忆」继续回复。
- 不记录完整对话体到日志（CLAUDE.md 禁止：PII）。

## 7. 测试策略

沿用现有 integration test 栈（真 Postgres + Qdrant，mock LLM/embedding 外部 API）：

1. `extractAndStore` 抽出事实并双写 Qdrant + PG。
2. 去重：相同事实第二次进来被跳过（NOOP）。
3. `recallMemories` 按 user_id 召回、不串其他用户。
4. 无 key 用户静默跳过、不报错。
5. stream 端到端：第二轮对话能在 system prompt 看到第一轮存的记忆。

## 8. 范围边界（YAGNI）

- **本次不做**：A2A 路径接入记忆。但 `recallMemories` 设计为可独立调用，`a2a.ts:328` 的 `conversationHistory: []` 缺口可在后续用同一函数补（预留接口，本次不强接，避免范围蔓延）。
- **本次不做**：记忆的「更新/失效」（Mem0 的 UPDATE/DELETE 语义）。当前只做 ADD + NOOP 去重。事实演化（如「用户搬到了新城市」覆盖旧事实）留待后续。
- **本次不做**：按 agent 维度隔离（user_id+agent_id）。MVP 每用户基本只有一个 agent，按 user_id 足够。
- **本次不做**：记忆条数上限/淘汰策略（监控后再定）。

## 9. 契约与约束遵守

- Migration 走 `db:generate`，不手写 SQL。
- Qdrant point id 用 `toUUID`（ULID 会被 Qdrant 拒）。
- 不向 client 发送 LLM key；key 仅服务端解密使用。
- 日志不含完整 A2A/对话请求体。
- Docker 容器间用服务名（`qdrant:6333`）而非 localhost。
- 注入的记忆是 LLM 从该用户自己历史消息中抽取的事实，拼入其 system prompt。潜在的「自我 prompt 注入」（用户存入对抗性「事实」后影响自己 agent）影响域仅限该用户自己的会话，非跨用户风险，按预期行为处理；后续若引入跨用户/跨 agent 记忆共享需重新评估。
