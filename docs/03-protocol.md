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

按 did:web 规范，带路径段的**子标识符 DID** 解析到路径段对应的文档（**不是**实例根的 `.well-known`）：

- `did:web:acme.com:agents:laowang` → `https://acme.com/agents/laowang/did.json`（冒号→斜杠，末尾接 `/did.json`）
- 裸实例 DID `did:web:acme.com` → `https://acme.com/.well-known/did.json`
- 真实端口用 `%3A` 编码：`did:web:acme.com%3A3000:agents:laowang` → `https://acme.com:3000/agents/laowang/did.json`（裸冒号 `:8080` 是路径段，不是端口）

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
- 防重放：请求 `Date` 限定在 5 分钟时间窗口内，且每个已验证的签名会记入重放缓存（nonce），窗口内再次提交同一请求会被拒绝；签名验证即可确认发送方身份

### 入站请求示例

```http
POST /a2a/v1/messages HTTP/1.1
Host: acme.com
Content-Type: application/json
Date: Sun, 24 Nov 2024 14:30:00 GMT
Content-Digest: sha-256=:X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=:
Signature-Input: sig1=("@method" "@authority" "@path" "content-digest" "date");keyid="did:web:vendor-x.com#key-1";created=1732458600;alg="ed25519"
Signature: sig1=:aBcDeF...:
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

1. 解析 `Signature-Input` 与 `Signature` header
2. 从 `Signature-Input` 的 `keyid` 参数提取 DID
3. 拉 DID document（带缓存：ETag + 60s TTL）
4. 取出公钥，按 RFC 9421 §2.5 重建签名基串并验证 signature
5. 验证 `Content-Digest` 匹配 body 哈希
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

### 线程绑定（thread_id 的作用域）

入站消息里的 `thread_id` 是 peer 的**请求**，不是权威指令。gateway 只在同时满足两个条件时**按原值**复用它：

1. 该 peer 已是这条会话的参与者；
2. 这条会话**属于被寻址 Agent 的主人**（`conversations.created_by`）。

第 2 条不可省略：`peer_agents` 按 DID 全局唯一，同一个 peer 可以同时连接多个主人。只校验第 1 条的话，一个连接了 A 和 B 的 peer 就能在给 B 的 Agent 发消息时带上 A 的 `thread_id`，把消息灌进 A 的会话——B 的 Agent 会以 A 的历史为上下文作答，回复被写进 A 的线程并广播给 A，A 的会话内容还会经记忆沉淀进 B 的长期记忆。

两条都满足说明对方是在回答我方发出的消息（`thread_id` 就是我方的会话 id）。不满足时那是 **peer 自己编号里的线程**——本地不指向任何东西，但对 peer 而言是稳定的，所以我方会话 id 由 `sha256('a2a-thread:<主人 id>:<peer 行 id>:<peer 的 thread_id>')` 推导（`lib/derived-id.ts`，输出 26 位 Crockford，与 ULID 同形）。这样同一个 peer 线程里的后续消息始终落回同一条会话。

早先把「不认识的 thread_id」当作「没有线程」，于是接收方**每收到一条消息就新建一条会话**：追问与原问题永不同处，主人的会话列表堆满只有一句话的线程，`loadA2AHistory` 无历史可取，Agent 每轮都当作初次对话作答。

推导而非「存一张映射表」有两个好处：不需要迁移，且天然无竞态——两条消息同时到达会在主键上冲突，而不是各建一条会话（因此建会话走事务 + `onConflictDoNothing`）。拼接串里只有**最后一段**允许是 peer 可控的变长值，前面各段都是定长 26 位 id，冒号不转义也不会产生歧义。

新建会话时，**主人与 peer 同时**写入 `conversation_participants`。主人那条参与者行是会话列表和逐会话读取闸门的依据，缺了它主人就看不到自己 Agent 正在应答的线程。

`thread_id` 因此是**每一侧各自的**会话 id，两边不相同。由此得出两条不可省的规则：

- **回复必须回显提问方发来的 `thread_id`，不是自己的。** 上面第 2 条会（正确地）拒绝一条不属于自己的线程，所以带着我方会话 id 回去的答复，会被对端归进一条全新会话；提问方仍在轮询自己创建的那条，于是 `/api/v1/consult/{id}/reply` 永远停在 `pending`，而两台机器上都躺着一个完好的答案。
- **`messages.thread_root` 写本地会话 id，绝不写 peer 给的原值。** 该列是 `char(26)`，为我们自己的 ULID 而设：存外来值既会指向一条我们可能并不拥有的会话，也让任何 peer 能用一个超过 26 字符的 `thread_id` 把这个端点打成 500。入站 `thread_id` 另有长度上限校验。

### 答不出来也要回话

被寻址的 Agent 跑不了这一轮时（没配模型、厂商不认识、配了厂商但没有 key、模型调用抛错），回一条 `type: 'notification'`，`context.error` 携带机器可读的原因码（`no_model_configured` / `unknown_provider` / `no_key_for_provider` / `agent_error`），`content` 是一句英文说明。用 `notification` 是因为它不会在对端触发再一次自动回复（只有 `question` 会）。

不这样做的后果不是「少一条提示」：失败只在应答方打一行日志，什么都不发出去，提问方的 `/api/v1/consult/{id}/reply` 就一直轮询到超时并返回 `pending`——每次重试都一样，**没有任何办法区分「还在想」和「永远不会来」**。

跨实例的对端不共享我们的语言，所以判断依据是 `context.error` 这个码；`content` 只是兜底的人类可读文本。这与「服务端不生成用户文案」并不冲突：那条规则约束的是发给**本实例自己客户端**的文案。

### 寻址：两个 DID 都指向同一个 Agent

`to` 同时接受 **Agent DID**（`did:web:<host>:agents:<user>:agent`，公开目录 `/.well-known/agents.json` 列出的就是它）和**主人 DID**（`did:web:<host>:agents:<user>`）。后者是唯一能被解析出 DID 文档的标识，也是客户端展示给用户复制的那一个——只认前者会让「粘贴 DID 加好友」得到一个连得上、验得过、却 404 的联系人。

同理，判定发件 peer 是否已连接时，`from`（Agent DID）与**验签得到的签名者 DID**（主人 DID）都要认：`peer_agents` 按 DID 建行，联系人存的是哪一个取决于当初用什么方式添加，只认 `from` 会让对端的回复变成一条「陌生人的连接请求」。

### Pending inbox（离线代答）

主人离线时收到**已连接** peer 的问题，由 policy engine 决定（`evaluatePolicy`，action=`ask`，L2）：

- `allow`（默认——连接即同意）→ Agent 直接答（`201` + 自动回复循环）
- `ask_user`（主人显式设 `policies_json.default='ask_user'` 或 `{action:'ask',decision:'ask_user'}` 规则）→ **已实现**：入站提问仍存库 + 广播（主人能在 IM 看到），但**不自动回复**；落一条 `action='ask'` 待批权限到 pending inbox，`POST /a2a/v1/messages` 返回 `202 { "status": "pending_approval", "message_id" }`。主人在 `GET /permissions/pending` 看到该提问，`POST /permissions/{id}/decide` 判 `allow_*` 即触发 Agent 代答（写 `in_reply_to` 回复 + 出站投递），判 `deny` 则不答。peer 侧 `GET /a2a/v1/stream/{message_id}` 在批准前返回 `status:'pending'`，批准后返回答复。
- `deny`（显式拒绝规则）→ `403 policy_denied`

> **A2A 代答能力**：入站 A2A 应答与 web 聊天走**同一套共享编排**（`orchestration/agent-orchestrator.ts` 的 `runAgentTurn`）。Agent 代答时会用**主人**（非提问 peer）的密钥按需调用工具——`search_knowledge_base`（检索主人私有知识库）与 `web_search`（Tavily），并注入该主人的**长期记忆**召回；命中的知识库片段作为**引用**持久化到 `messages.citations_json`，答完后异步把本轮事实沉淀进长期记忆。主人未配 embedding/KB/tavily 密钥时优雅降级为纯 LLM 应答（不报错、无引用）。`allow` 与 `ask_user` 批准后的代答路径共用此编排。

> `ask='ask'` 的待批权限 `scope_json` 形如 `{ kind:'a2a_question', conversation_id, inbound_message_id, sender_did, peer_id, content }`，足以在批准时重建并恢复回答（按 `user_id`/`peer_id` 实时取 agent/peer，幂等：已有回复则跳过）。standing-policy 设置 UI、「编辑后回答」、push 通知仍为 backlog。

## 联邦发现

### 域名查找

输入域名 `acme.com`，客户端：

1. 拉 `https://acme.com/.well-known/did.json` 拿主 DID
2. 拉 `https://acme.com/.well-known/agents.json` 列出该域名下所有公开 Agent
3. 选一个加为联系人

### 用户 DID 解析

拿到某用户 Agent 的子标识符 DID 后，按 did:web 规范解析其 DID document：

- `did:web:acme.com:agents:laowang` → `GET https://acme.com/agents/laowang/did.json`
- 裸实例 DID `did:web:acme.com` → `GET https://acme.com/.well-known/did.json`

入站 A2A 验签即走这条路径：从 `Signature-Input` 的 `keyid` 抽出签名者 DID → 解析到上述 URL → 取 `verificationMethod` 里与 `keyid` 匹配的公钥验签。该文档只暴露公钥材料，`verificationMethod[*].id` 为存库的 `key_id`（不由请求 Host 重拼），故跨实例解析与本地自解析拿到的 id 恒一致。

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
