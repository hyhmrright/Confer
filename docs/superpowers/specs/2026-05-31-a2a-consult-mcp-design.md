# A2A 咨询 + MCP 接入设计

- 日期:2026-05-31
- 状态:已批准,待写实现计划
- 作者:hyhmrright(与 Claude Code 协作 brainstorm)

## 1. 目标与场景

开发者在 Claude Code 里编写 Confer 代码时,把**已是自己联系人**的 peer A2A Agent
当作"编码咨询资源":发现该问谁、向其提问、拿到回复,再据此写代码。Claude Code
扮演 **A2A 客户端**,全程不依赖 localhost 网页。

非目标(本期不做):
- 让 Claude Code 反过来成为被别人调用的 A2A 服务端(双向)。
- 用裸 DID 临时发现陌生 agent(范围限定为已有联系人/会话)。
- 改动现有"用户 ↔ 自己本地 LLM 助手"的会话/stream 体验。

## 2. 关键现状发现(驱动本设计)

追踪现有代码得到的事实:

| 链路 | 现状 | 证据 |
|------|------|------|
| 入站 A2A → 自动回复 | 存在,是**唯一**的 A2A 发消息路径 | `routes/a2a.ts:450` 调 `sendA2AMessage` |
| 联系人发现 / lookup | 存在,仅拉 `.well-known/agents.json` | `routes/contacts.ts:165` |
| **用户主动发消息给 peer 并投递** | **不存在**(网页与 REST API 均无) | 全仓库 `sendA2AMessage` 仅 a2a.ts 自动回复处调用 |
| 网页"会话/发消息/stream" | 是与**自己的本地 LLM 助手**对话,不走 A2A | `routes/stream.ts:66` 恒取 `user_id=自己` 的 agent 跑 LLM |

数据模型已预留 peer 会话:`conversation_participants.peer_id` 与 `participant_type`
(`db/schema.ts`),但用户发起的出站投递逻辑未实现。

结论:本功能需要在 gateway **补齐平台缺失的"用户发起出站咨询"能力**,再叠加
面向 Claude Code 的 MCP 层。纯 MCP 薄封装不可行(底层能力不存在)。

## 3. 架构(两层)

```
Claude Code ──(MCP stdio)──► MCP server (packages/mcp-a2a)
                                  │ 认证 REST(以一个配置用户的 token)
                                  ▼
              Gateway 新增 /api/v1/consult/* 出站咨询能力
                                  │ 复用
                                  ▼
        sendA2AMessage / RFC9421 签名 / DID / AgentFacts / policy 引擎
```

- 私钥永不离开 gateway(遵守"密钥不出 gateway"硬约束);MCP 只持 gateway token。
- 咨询走独立 `/consult/*` 路径,与本地助手 `stream.ts` 互不干扰,靠
  `participant_type` 区分会话类别。

## 4. Layer 1:Gateway 出站咨询能力

### 4.1 新增 REST 端点(网页 / MCP 共用,走现有用户鉴权中间件)

| 端点 | 作用 |
|------|------|
| `POST /api/v1/consult/:peerId` | 发起或续聊咨询:建立/复用 `participant_type='peer'` 会话,签名并投递 A2A 消息;返回 `{ conversation_id, message_id, status }` |
| `GET /api/v1/consult/:conversationId/reply?after=:messageId&wait=Ns` | 长轮询等待 peer 异步回复,直到出现新的 `sender_type='peer'` 消息或 `wait` 超时 |
| `GET /api/v1/consult/:conversationId` | 拉取该咨询线程完整历史 |

### 4.2 出站投递逻辑

- 取当前用户 active agent 的 keypair → `signRequest` → 复用 `sendA2AMessage` 投递到
  `peerAgents.endpoint`。
- 落库 `messages(sender_type='user', via='a2a', delivery_status)`;成功置 `sent`,
  失败置 `failed` 并保留错误信息。
- A2A 消息体:`type='question'`,`thread_id = conversation_id`。

### 4.3 异步回调关联(关键)

- peer 答案经现有入站 `POST /a2a/v1/messages` 返回,携带 `thread_id`。
- 入站处理器按 `thread_id → conversation_id` 将回复写入**同一线程**
  (`sender_type='peer'`),并 `broadcastToConversation`(唤醒网页实时订阅与长轮询)。
- 幂等:以 `in_reply_to` + `message_id` 去重,容忍乱序/重发。

### 4.4 不改动项

- `routes/stream.ts`(本地 LLM 助手)逻辑不变。
- 入站自动回复路径(a2a.ts)行为不变,仅在按 `thread_id` 关联时增加"挂回已有咨询
  线程"的分支。

## 5. Layer 2:MCP server(`packages/mcp-a2a`,新 workspace 包)

stdio 进程。启动时以**一个配置的 Confer 用户**登录 gateway 取 token;该用户即 MCP 的
行动身份;签名仍由 gateway 完成。

工具清单(按四个能力域):

**域 1 发现与认知**
- `list_agents()` — 联系人 + DID + 名称
- `get_agent_capabilities(peerId)` — 读 AgentFacts(擅长领域 / skill / 语言)
- `find_agents(capability)` — 按能力检索匹配联系人

**域 2 咨询对话(核心)**
- `ask_agent({ peerId, question, codeContext?, waitSeconds? })` — 发起咨询;
  `waitSeconds>0` 阻塞等回调返回答案,否则返回 `{ conversationId, messageId }`
- `follow_up({ conversationId, question, waitSeconds? })` — 同线程多轮追问
- `get_conversation(conversationId)` — 历史

**域 3 进阶模式**
- `ask_multiple({ peerIds[], question })` — 并行咨询多个 peer,汇总对比
- `check_reply({ conversationId, afterMessageId })` — 异步票据:不阻塞,主动取回复

**域 4 运维与安全**
- `whoami()` — 当前 MCP 行动身份
- 权限闸门:peer 需 capability token / L3 待批 → 返回 `pending_approval`,不静默失败
- 错误透传:offline / no-endpoint / 验签失败 / 超时 → 结构化错误
- PII:不记录完整 A2A body,仅 `message_id` / `thread_id` / `status`

## 6. 数据流(同步咨询主路径)

```
Claude Code ──ask_agent──► MCP ──POST /consult/:peerId──► Gateway
                                                            │ sign + sendA2AMessage
                                                            ▼
                                                      Peer Agent(异步思考)
Gateway ◄──POST /a2a/v1/messages(thread_id)──────────────┘
   │ 按 thread_id 挂回线程 + broadcastToConversation
   ▼
MCP(长轮询 /consult/.../reply 被唤醒)──► 返回答案 ──► Claude Code 据此写代码
```

## 7. 错误处理与安全

- 投递失败 → `delivery_status='failed'` + 错误文案;MCP 返回结构化 error。
- peer 超时无回复 → 长轮询超时返回 `pending`;Claude 可改用 `check_reply` 稍后取。
- L3 权限 → 复用 agent-runtime policy 引擎;MCP 上报待批,不自动接受 L3(硬约束)。
- gateway token 失效 → MCP 自动重新登录一次后重试。

## 8. 测试策略(遵循 CLAUDE.md)

- **Layer 1**:`consult.integration.test.ts` — 真实 Postgres;mock peer endpoint
  (出站 fetch)+ 模拟入站回调;验证"发起 → 投递 → 回调关联 → 长轮询拿到回复"闭环,
  覆盖权限 / 投递失败 / 超时分支。
- **Layer 2**:MCP server 单元测 — mock gateway REST;验证工具 schema(MCP SDK
  校验严格,需真实 Claude Code 连接做冒烟)、阻塞 / 票据两种模式、错误透传。
- 回归:现有 `stream.ts` 与入站自动回复测试保持通过。

## 9. 已定默认(可推翻)

- 传输:stdio 本地进程,配 `.mcp.json`。
- MCP 身份:一个配置的注册用户,经 gateway token,私钥不出 gateway。
- 新包名:`packages/mcp-a2a`。

## 10. 待确认 / 风险

- **MVP 范围**:本功能超出 `docs/08-mvp-backlog.md` v0.1 当前形态,属能力扩张,
  需在实现前与 backlog 对齐(CLAUDE.md 要求)。
- **文档同步**:实现时需更新 `docs/` 中 API / A2A / MCP 对应文件(CLAUDE.md 硬规则)。
- **长轮询 vs SSE**:回复获取首版用长轮询(实现简单、与 MCP 请求-响应模型契合);
  若后续需要更实时可换 SSE/WebSocket。
- **并发上限**:`ask_multiple` 的并行度需设上限,避免一次性烧光接收方 token。
