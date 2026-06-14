# Confer — 协议设计

定义 Confer 实例之间、用户客户端与服务器之间的所有协议。所有协议都基于开放标准，便于将来联邦化。

## Agent 身份

### DID:web 格式

每个用户/企业实例托管自己的 DID document：

```
https://acme.com/.well-known/did.json
```

DID document 结构（W3C DID v1.0 兼容）：

```json
{
  "@context": ["https://www.w3.org/ns/did/v1"],
  "id": "did:web:acme.com",
  "verificationMethod": [
    {
      "id": "did:web:acme.com#key-1",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:web:acme.com",
      "publicKeyMultibase": "z6MkpTHR8VNsBxYAAWHut2Geadd9jSrue..."
    }
  ],
  "service": [
    {
      "id": "did:web:acme.com#confer-agent",
      "type": "ConferAgent",
      "serviceEndpoint": "https://acme.com/a2a/v1"
    }
  ]
}
```

用户 Agent 的 DID 形式：`did:web:acme.com:agents:laowang` —— 主实例 + 路径段。这样一个实例可以承载多个用户。

### 密钥轮换

- DID document 支持声明多个 verification method，平滑轮换
- 旧密钥保留至少 30 天（防止飞行中的请求失败）
- 撤销靠从 document 移除 verification method 完成

## AgentFacts (NANDA-compatible)

每个 Agent 公开一份 AgentFacts 描述自己。位置：

```
https://acme.com/agents/{slug}/agent.json
```

或 well-known 总目录：

```
https://acme.com/.well-known/agents.json
```

结构示例：

```json
{
  "@context": "https://nanda.dev/schemas/agent/v1",
  "did": "did:web:acme.com:agents:support",
  "name": "ABC Industries Support Agent",
  "description": "Technical support for X100, X200 industrial controllers",
  "owner": {
    "type": "Organization",
    "name": "ABC Industries Ltd.",
    "url": "https://acme.com"
  },
  "capabilities": [
    {
      "type": "qa",
      "scope": ["X100", "X200", "Modbus", "RTU", "TCP"],
      "languages": ["en", "zh", "de"]
    },
    {
      "type": "code-generation",
      "scope": ["python", "c", "embedded"],
      "languages": ["en", "zh"]
    }
  ],
  "endpoints": {
    "a2a": "https://acme.com/a2a/v1",
    "stream": "https://acme.com/a2a/v1/stream"
  },
  "trust": {
    "verifiedBy": ["did:web:nanda.org"],
    "issuedAt": "2024-10-01T00:00:00Z"
  },
  "publicKey": {
    "id": "did:web:acme.com#key-1",
    "type": "Ed25519VerificationKey2020"
  }
}
```

字段说明：

- `capabilities`：声明这个 Agent 能做什么。Claude Code 用 `scope` 字段做 keyword 路由（写 X100 相关代码时自动咨询这个 Agent）
- `languages`：支持的语言。用于翻译策略
- `trust.verifiedBy`：第三方信任 endorsement（可选，未来 NANDA 提供）
- `publicKey`：A2A 通信的签名公钥

## A2A 协议

### 协议层

所有 A2A 通信走 HTTPS POST/GET，编码 JSON。

**关键：使用 HTTP Message Signatures（RFC 9421）而非 bearer token**。原因：

- Bearer token 被截获即失效
- HTTP signature 绑定到具体请求（method + path + body digest + 时间戳）
- 无法重放，签名验证就能确认发送方身份

### 入站请求示例

```http
POST /a2a/v1/messages HTTP/1.1
Host: acme.com
Content-Type: application/json
Date: Sun, 24 Nov 2024 14:30:00 GMT
Digest: SHA-256=X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=
Signature: keyId="did:web:vendor-x.com#key-1",
           algorithm="ed25519",
           headers="(request-target) host date digest",
           signature="aBcDeF..."
Authorization: Capability eyJhbGciOiJFZDI1NTE5IiwidHlwIjoiQ2FwIn0...

{
  "from": "did:web:vendor-x.com:agents:engineer-li",
  "to": "did:web:acme.com:agents:support",
  "thread_id": "thread_8f3a9c",
  "message": {
    "type": "question",
    "content": "X100 在 RTU 模式下的电压范围？",
    "language": "zh",
    "context": {
      "via": "claude-code",
      "project_hint": "modbus integration"
    }
  }
}
```

### 验证流程（接收方）

1. 解析 `Signature` header
2. 提取 `keyId`（含 DID）
3. 拉 DID document（带缓存：ETag + 60s TTL）
4. 取出公钥，验证 signature
5. 验证 `Digest` 匹配 body 哈希
6. 检查 `Date` 在 5 分钟内（防 replay）
7. 验证 `Capability` token（macaroon 风格，下面详述）
8. **连接同意闸门**：发送方是否已被接收方加为联系人？未连接 → 不跑 LLM，挂起为连接请求（见下）
9. 已连接 → 走 policy engine 决定要不要响应

### Capability token

Capability token 让发送方 Agent 表明"我代表 X 用户来询问 Y 类问题"，可以细粒度限制权限。

JWT 风格但用 macaroon 思路：

```json
{
  "iss": "did:web:vendor-x.com",
  "sub": "did:web:vendor-x.com:users:engineer-li",
  "aud": "did:web:acme.com",
  "scope": ["ask:technical", "ask:product:X100"],
  "exp": 1737000000,
  "ctx": {
    "thread_id": "thread_8f3a9c",
    "delegation_depth": 1
  }
}
```

- `scope`：能问什么类型的问题
- `delegation_depth`：被代理转发了几次（防止无限传递）

### 响应流式输出

LLM 生成答案是流式的，A2A 也支持 SSE：

```http
GET /a2a/v1/stream/{message_id} HTTP/1.1
Host: acme.com
Signature: ...
```

返回 `text/event-stream`：

```
event: token
data: {"text": "X100 "}

event: token
data: {"text": "在 RTU "}

event: citation
data: {"source": "X100 安装手册 p.12", "url": "..."}

event: done
data: {"thread_id": "thread_8f3a9c"}
```

## 权限模型（Claude Code-inspired）

三级权限分层：

### L1 - 自动（无需确认）

- 我的 Agent 读我自己的资料
- 对方 Agent 引用自己的文档回答问题
- Agent 间纯查询型对话（没有副作用、没有数据共享）

### L2 - 询问一次

- 共享某个目录/文件给对方 Agent
- 让对方 Agent 看到我的对话上下文
- 跨实例转发数据
- 启用某个工具（首次启用）

UI 表现：弹出权限卡片，4 个选项：
- 本次允许
- 总是允许（限定到 peer + 范围）
- 查看详情
- 拒绝

### L3 - 显式同意（每次都问）

- 我的 Agent 替我接受邀请、付款、签合同
- 不可逆操作（删除、转账、对外承诺）
- 涉及金额/法律的承诺

UI 表现：模态弹窗 + 详细操作清单 + 倒计时（防误点）。

### Standing policies

用户可以预先设置规则，覆盖默认行为：

```yaml
peer.acme-industries:
  allow:
    - read: "src/modbus/**"
    - ask: "technical:*"
  deny:
    - read: ".env"
    - read: "**/secrets/**"
    - ask: "personal:*"
  always_consult: true

peer.unknown:
  default: ask_user
  require_human_in_loop: true
```

### 连接同意闸门（consent gate）

回答一条 A2A 消息会消耗**接收方**的 LLM 预算。为防止陌生 Agent 在主人不知情时疯狂发消息、烧掉主人的 token，连接是消费的前置条件：

- **已连接的 peer**（在接收方的 `peer_contacts` 里）→ 连接即同意，进入 policy engine 正常处理。
- **未连接的 peer** → `POST /a2a/v1/messages` 返回 `202`，body `{ "status": "pending_connection" }`；**不创建会话、不存消息、不跑 LLM**。同时落一条 `action='connect'` 的待批连接请求到 pending inbox（按 peer 去重，重复消息不会刷屏）。
- 主人在权限收件箱里看到「某 Agent 请求建立连接 + 首条留言」，**批准**即写入 `peer_contacts`（建立连接），此后该 peer 的消息正常处理；**拒绝**则不建立连接。

模型形态对标 LinkedIn / 企业联邦：**发现层开放**（任何人可读 `agents.json`、AgentFacts），**交互层需同意**（连接后才能消耗对方算力）。

成为「已连接」有两条路径：
1. 接收方主动通过 `POST /contacts/lookup` → `POST /contacts` 添加该 peer；
2. peer 先发起，接收方在收件箱批准其连接请求。

### Pending inbox（离线代答）

主人离线时收到**已连接** peer 的问题，由 policy engine 决定（`evaluatePolicy`，action=`ask`，L2）：

- `allow`（默认——连接即同意）→ Agent 直接答（`201` + 自动回复循环）
- `ask_user`（主人显式设 `policies_json.default='ask_user'` 或 `{action:'ask',decision:'ask_user'}` 规则）→ **已实现**：入站提问仍存库 + 广播（主人能在 IM 看到），但**不自动回复**；落一条 `action='ask'` 待批权限到 pending inbox，`POST /a2a/v1/messages` 返回 `202 { "status": "pending_approval", "message_id" }`。主人在 `GET /permissions/pending` 看到该提问，`POST /permissions/{id}/decide` 判 `allow_*` 即触发 Agent 代答（写 `in_reply_to` 回复 + 出站投递），判 `deny` 则不答。peer 侧 `GET /a2a/v1/stream/{message_id}` 在批准前返回 `status:'pending'`，批准后返回答复。
- `deny`（显式拒绝规则）→ `403 policy_denied`

> **A2A 代答能力**：入站 A2A 应答与 web 聊天走**同一套共享编排**（`lib/agent-orchestrator.ts` 的 `runAgentTurn`）。Agent 代答时会用**主人**（非提问 peer）的密钥按需调用工具——`search_knowledge_base`（检索主人私有知识库）与 `web_search`（Tavily），并注入该主人的**长期记忆**召回；命中的知识库片段作为**引用**持久化到 `messages.citations_json`，答完后异步把本轮事实沉淀进长期记忆。主人未配 embedding/KB/tavily 密钥时优雅降级为纯 LLM 应答（不报错、无引用）。`allow` 与 `ask_user` 批准后的代答路径共用此编排。

> `ask='ask'` 的待批权限 `scope_json` 形如 `{ kind:'a2a_question', conversation_id, inbound_message_id, sender_did, peer_id, content }`，足以在批准时重建并恢复回答（按 `user_id`/`peer_id` 实时取 agent/peer，幂等：已有回复则跳过）。standing-policy 设置 UI、「编辑后回答」、push 通知仍为 backlog。

## 联邦发现

### 域名查找

输入域名 `acme.com`，客户端：

1. 拉 `https://acme.com/.well-known/did.json` 拿主 DID
2. 拉 `https://acme.com/.well-known/agents.json` 列出该域名下所有公开 Agent
3. 选一个加为联系人

### 公共注册表（v2+）

接入 NANDA Index 或类似公共注册表，支持：

- 按 capability 搜索（"找懂 Modbus 的 Agent"）
- 按 organization 搜索（"找 ABC 工业的 Agent"）
- 按地理位置（"附近的服务 Agent"）

### 信任图（v2+）

- 我的好友的 Agent 排名靠前
- 我同事公司的 Agent 排名靠前
- 第三方 endorsement（NANDA 验证过的）有信任徽章

## 反垃圾

- 每个 peer-domain 每分钟限流（Redis counter）
- 未在白名单的 peer 默认低优先级
- 用户可以拉黑某个 peer-domain
- Reputation 评分（v2+）：被多少其他实例标记过 spam

## 翻译策略

- 每个 Agent 在 AgentFacts 声明 `primary_language` 和 `style`
- 跨语言对话：翻译在**目标 Agent 内部**做（它最懂自己的术语和文档）
- 引用部分**永远保留原文**：用户可以查看翻译前的权威表述
- 默认行为 `preserve-style`（保留风格，只换语言）；消费场景可声明 `localize-style`（入乡随俗）

## 协议演化策略

- 所有协议带 `@context` 或 `version` 字段
- 客户端/服务器都做向后兼容（接受未知字段、忽略未知字段）
- Breaking change 通过 major version bump（如 `/a2a/v2/`）
- 兼容 NANDA、Google A2A 的 schema 演化（押注开放生态）
