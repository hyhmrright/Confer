# Confer — API 规范

定义客户端 ↔ 服务器、服务器 ↔ A2A peer 的所有 API。

## 通用约定

- Base URL: `https://{instance}/api`
- 编码: JSON, UTF-8
- 时间格式: ISO 8601, UTC（`2024-11-15T14:30:00Z`）
- ID: ULID (`01HXKQ7Z2N3M4P5R6T7Y8Z9A0B`)
- 错误格式:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Human-readable message",
    "details": { /* optional */ }
  }
}
```

## 认证

- 用户客户端: `Authorization: Bearer <jwt_access_token>`
- Access token TTL: 15 分钟
- Refresh token TTL: 90 天，存 HTTP-only cookie

## 客户端 API（用户客户端使用）

### 认证

```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
POST   /api/v1/auth/oauth/{provider}    # OAuth callback
```

`POST /api/v1/auth/login` 请求:

```json
{
  "username": "laowang",
  "password": "...",
  "device_id": "ios-abc123",
  "device_info": { "platform": "ios", "model": "iPhone 15", "os": "17.1" }
}
```

响应:

```json
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "expires_in": 900,
  "user": { /* User object */ }
}
```

### 用户和 Agent 配置

```
GET    /api/v1/users/me
PATCH  /api/v1/users/me
GET    /api/v1/agents/me
PATCH  /api/v1/agents/me
PUT    /api/v1/agents/me/policies
GET    /api/v1/agents/me/llm-keys      # 每个 provider 是否已配置（只返回布尔，不返回密钥）
PUT    /api/v1/agents/me/llm-keys      # 加密存储 LLM API keys
DELETE /api/v1/agents/me/llm-keys/{provider}
GET    /api/v1/agents/me/llm-keys/{provider}/models   # 向厂商实时查询可用模型
```

`provider` 取值来自 `@confer/shared` 的 provider 目录（`packages/shared/src/llm/catalog.ts`），
外加工具服务 `tavily`。目录同时被 gateway、agent-runtime 和客户端读取——base URL、模型列表
路径、默认模型都只写在那一处，新增厂商只改目录。

`/models` 直接转发厂商自己的模型清单，永远不返回本地维护的名单：

```jsonc
{ "models": [{ "id": "gpt-4o" }] }
// 空列表必定带上原因，四种互不相同，各自对应不同的补救动作
{ "models": [], "error": "no_key" }        // 该 provider 还没配置密钥
{ "models": [], "error": "unauthorized" }  // 厂商拒绝了这个密钥（401/403）
{ "models": [], "error": "unreachable" }   // 连不上厂商，或它返回了其他错误
{ "models": [], "error": "unsupported" }   // 该厂商不提供模型清单接口
```

### 联系人 / Peer Agents

```
GET    /api/v1/contacts                     # 列出联系人。分页：?limit=&offset=
POST   /api/v1/contacts                     # 添加联系人
GET    /api/v1/contacts/{contact_id}        # 单个联系人详情（带 peer）
DELETE /api/v1/contacts/{contact_id}
PATCH  /api/v1/contacts/{contact_id}        # 局部修改 alias / tags / pinned / muted（未传字段不清空）

POST   /api/v1/contacts/lookup              # 按 DID / 域名 / username 查找
```

`POST /api/v1/contacts/lookup` 请求:

```json
{
  "method": "domain",          // domain | did | username | qr_code | phone
  "value": "abc-industries.com"
}
```

`GET /api/v1/contacts` 返回 `{ contacts, total }`。`limit` 默认 50、上限 100，`offset` 默认 0；按 `id`（ULID）倒序，即最新在前——排序是唯一且确定的，offset 窗口才不会漏行或重行。`total` 是全量计数而非本页条数，客户端据此判断"已到底"。无法解析的 `limit`/`offset` 取默认值而非报错。

响应：返回找到的候选 Agent 列表。lookup 会把发现到的 peer **落库到 `peer_agents`** 并在每个候选里带上本地 `id`（`peer_id`）——`POST /api/v1/contacts` 正是用这个 `id` 添加联系人。`POST /contacts` 幂等：重复添加同一 peer 返回已存在的联系人（`200`）而非报错。

> 添加联系人是**接收方授予对方"可消费我的 Agent"的同意**：被加为联系人的 peer 才能触发我的 Agent 回答（消耗我的 LLM 预算）。未连接 peer 发来的 A2A 消息会被挂起为待批连接请求，见 `03-protocol.md` 的「连接同意闸门」。

```
POST   /api/v1/contacts/{contact_id}/policies   # 设置 standing policies（整体替换，PUT 语义）
```

`POST /contacts/{id}/policies` 的 body 是 runtime 形 `{ default?: 'allow'|'ask_user'|'deny', rules?: [{ action, peer_did?, decision }] }`，整体写入 `peer_contacts.policy_overrides_json`。**Merge 语义**：入站 A2A 决策时，该 per-contact 覆盖叠加在 agent 级 policy 之上——`contact.default` 在场则覆盖 agent 默认，`contact.rules` 前置于 agent rules 故先命中（per-contact 精确规则优先于 agent 通用规则）；空覆盖 `{}` 为恒等，与无覆盖时的决策逐字节一致。

### 对话

```
GET    /api/v1/conversations                       # 列出我的对话（首页用）
POST   /api/v1/conversations                       # 创建新对话
GET    /api/v1/conversations/{id}
PATCH  /api/v1/conversations/{id}
DELETE /api/v1/conversations/{id}

GET    /api/v1/conversations/{id}/messages         # 分页：?before=&limit=
POST   /api/v1/conversations/{id}/messages         # 发消息
GET    /api/v1/conversations/{id}/messages/{msg_id}/stream    # SSE 流式接收 LLM 回复

POST   /api/v1/conversations/{id}/participants     # 加入 participant
DELETE /api/v1/conversations/{id}/participants/{p_id}

POST   /api/v1/conversations/{id}/read             # 标记已读
```

`POST /api/v1/conversations/{id}/messages` 请求:

```json
{
  "content_type": "text",
  "content": "X100 寄存器 0x40 用什么功能码？",
  "in_reply_to": null,
  "via": "web"
}
```

响应：

```json
{
  "id": "01HXKQ...",
  "delivery_status": "queued",
  "stream_url": "/api/v1/conversations/01HX.../messages/01HXK.../stream"
}
```

### 权限管理

```
GET    /api/v1/permissions/pending               # 待处理的 L2/L3 请求
POST   /api/v1/permissions/{id}/decide           # 批准/拒绝
GET    /api/v1/permissions/history               # 历史记录
```

`POST /api/v1/permissions/{id}/decide` 请求:

```json
{
  "decision": "allow_always",       // allow_once | allow_always | deny | deny_always
  "scope": "peer_action"            // 限定范围
}
```

待批请求里 `action='connect'` 的是**连接请求**（陌生 peer 首次接触时由 A2A 入站生成）。批准（`allow_*`）会把该 peer 写入 `peer_contacts`，建立连接；拒绝则不建立。

`action='ask'` 的是**已连接 peer 的待批提问**——当主人的 Agent 策略对该提问判为 `ask_user` 时由 A2A 入站生成（见 `03-protocol.md` 的「Pending inbox（离线代答）」）。批准（`allow_*`）触发 Agent 代答这条挂起的提问；拒绝则不回答。

`GET /pending` 为每条请求附带 `description`（连接请求含发起方与首条留言；提问含发起方与问题正文）便于主人判断。

### 项目记忆（Claude Code 集成相关）

```
GET    /api/v1/projects/{project_id}/peers              # 该项目下有记忆的 peer（join 出 name/did）  ✅ 已实现
POST   /api/v1/projects/{project_id}/peers              # 显式注册 peer 到项目                       🔜 backlog
GET    /api/v1/projects/{project_id}/peers/{peer_id}/facts        # ✅ 已实现
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/facts        # ✅ 已实现
GET    /api/v1/projects/{project_id}/peers/{peer_id}/decisions    # ✅ 已实现
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/decisions    # ✅ 已实现
```

语义说明（v0.1）：

- 所有查询 scope 到 `user.sub`（跨用户隔离）。
- PUT 前校验 peer 是该用户联系人（`peer_contacts`），非联系人返回 `403 not_a_contact`。
- PUT 用 upsert：首次写入 `version=1`，再次写入 `version` 递增并刷新 `updated_at`。facts 与 decisions 各自独立——写一个 section 不会清空另一个。
- GET facts/decisions 在 (project, peer) 尚无记忆时返回 `200` + 空串 + `version:0`（不返回 404；「该 peer 暂无沉淀」是读语义下的正常态）。
- `project_id` 受 `^[a-zA-Z0-9._\-/]+$`（1–255 字符）校验，非法返回 `400 invalid_project_id`。
- `GET peers` 在空项目下返回空数组；记忆通过 PUT facts/decisions 隐式建立 (project, peer) 关系（本期不做 `POST peers` 显式注册）。

### 知识库（RAG）

```
GET    /api/v1/knowledge-bases                                  # 列出我的知识库
POST   /api/v1/knowledge-bases                                  # 新建
DELETE /api/v1/knowledge-bases/{kb_id}                          # 连同其全部文档与向量一并删除

GET    /api/v1/knowledge-bases/{kb_id}/documents                # 分页：?limit=&offset=
POST   /api/v1/knowledge-bases/{kb_id}/documents                # multipart upload，字段名 file
DELETE /api/v1/knowledge-bases/{kb_id}/documents/{doc_id}
POST   /api/v1/knowledge-bases/{kb_id}/documents/{doc_id}/retry # 重新入库
```

`POST /knowledge-bases` 的 body 是 `{ name, description? }`（`name` 1–255 字符），返回 `201` + `{ knowledge_base }`。`GET /knowledge-bases` 返回 `{ knowledge_bases }`，**不分页**：一个用户的知识库是手工建的，数量有界。

`GET /{kb_id}/documents` 返回 `{ documents, total }`。`limit` 默认 50、上限 100，`offset` 默认 0；按 `id`（ULID）倒序，即最新在前——排序唯一且确定，offset 窗口才不会漏行或重行。`total` 是全量计数而非本页条数。无法解析的 `limit`/`offset` 取默认值而非报错。这是本节唯一会无界增长的列表，因为知识库正是上传目标。

上传走 `multipart/form-data`，文件字段名固定为 `file`，单个文件上限 **10 MB**（超出返回 `400 bad_request`）。`Content-Type` 优先取表单里带的，缺失时按扩展名推断。响应 `201` + `{ document }`，此时 `status` 已是 `processing`：**切分、向量化、写入 Qdrant 是响应之后异步跑的**，上传接口不等它完成。客户端据此轮询文档列表直到 `status` 变化。

`status` 取值：

| 值 | 含义 |
|---|---|
| `processing` | 已入库、正在切分/向量化。上传与 retry 后的初始态 |
| `ready` | 可被检索。`chunk_count` 为该文档的分片数 |
| `failed` | 入库失败（解析、embedding key 缺失或向量库写入失败） |

`POST /{doc_id}/retry` 从对象存储取回原文件重新入库，先清掉该文档已有的向量再重跑，因此不会产生重复分片。原文件已不在（`storage_key` 为空）或文档仍在 `processing` 时返回 `400`。响应 `{ document }`，`status` 复位为 `processing`、`chunk_count` 归零。

删除知识库会级联删除其全部文档行与 Qdrant 中的向量；删除单个文档同时清理向量与对象存储中的原文件。向量/对象存储的清理失败不会阻断数据库删除——留下孤儿对象好过留下指向已删数据的行。

所有端点都 scope 到 `user.sub`：访问他人的 kb 或文档返回 `404`（而非 `403`，不泄露其存在性）。

> 反向代理需放行 10 MB 请求体。`infra/nginx.conf` 在 `/api/` 上设了 `client_max_body_size 10m`；用 nginx 默认的 1 MB 时，1–10 MB 的文件根本到不了 gateway，浏览器拿到的是 nginx 自己的 413 页面。

### 文件附件

```
POST   /api/v1/attachments                       # multipart upload
GET    /api/v1/attachments/{id}                  # 下载（302 redirect 到签名 URL）
DELETE /api/v1/attachments/{id}
```

## WebSocket

### 端点

```
WSS  /ws?token=<access_token>&device_id=<device_id>
```

### 消息格式

所有 WS 消息都是 JSON，含 `type` 字段：

```json
{ "type": "message.new", "data": { /* ... */ } }
```

### 客户端 → 服务器

```
ping                          // 心跳
subscribe.conversation        // 订阅某个对话
unsubscribe.conversation
typing.start
typing.stop
read.ack                      // 已读确认
```

### 服务器 → 客户端

```
pong
message.new                   // 新消息
message.updated
message.deleted
typing.update                 // 谁在打字
presence.update               // 联系人上下线
permission.request            // 需要用户决定的权限请求
agent.status                  // 我的 Agent 在做什么（"正在咨询 ABC Agent..."）
conversation.updated
```

`message.new` 示例:

```json
{
  "type": "message.new",
  "data": {
    "id": "01HXKQ...",
    "conversation_id": "01HX...",
    "sender_type": "peer_agent",
    "sender_id": "01HY...",
    "sender_did": "did:web:acme.com:agents:support",
    "content_type": "text",
    "content": "用 0x03 Read Holding Registers...",
    "citations": [
      {
        "source": "X100 通信手册 v3.2",
        "page": 87,
        "url": "https://acme.com/manuals/x100-v3.2.pdf#page=87",
        "trust_level": "authoritative"
      }
    ],
    "language": "zh",
    "created_at": "2024-11-15T14:30:00Z"
  }
}
```

`permission.request` 示例:

```json
{
  "type": "permission.request",
  "data": {
    "id": "01HXP...",
    "level": "L2",
    "action": "share_files",
    "scope": {
      "peer": "did:web:acme.com:agents:support",
      "paths": ["src/modbus/"],
      "exclude": [".env", "secrets/"]
    },
    "peer_name": "ABC Agent",
    "peer_did": "did:web:acme.com:agents:support",
    "requested_at": "2024-11-15T14:30:00Z"
  }
}
```

**载荷里没有 `description`，这是有意的。** 服务端不知道读者用什么语言，所以只发结构化事实
（`action` + peer 身份 + 已存储的 `scope`），供审批阅读的句子由客户端按 i18n 拼装
（`packages/client/src/lib/permission-text.ts`）。这条契约由 `@confer/shared` 的
`permissionRequestEventSchema` 单独拥有：gateway 出站前用它 parse，客户端入站后用它 parse。

`GET /api/v1/permissions/pending` 的每一行是同一个形状（额外带一个 `decision` 字段），
由同一个构造器生成，所以轮询到的行和 socket 推来的行逐字节一致。

## SSE（LLM streaming）

```
GET  /api/v1/conversations/{id}/messages/{msg_id}/stream
Accept: text/event-stream
```

事件类型：

```
event: token
data: {"text":"用 "}

event: token
data: {"text":"0x03 "}

event: tool_call
data: {"tool":"agent_network.ask_peer","args":{...}}

event: tool_result
data: {"result":"..."}

event: citation
data: {"source":"X100 通信手册 v3.2","page":87}

event: done
data: {"finish_reason":"stop","tokens_used":523}
```

## A2A API（对外，供其他 Confer 实例调用）

详见 `docs/03-protocol.md`。这里只列 endpoint。

```
POST   /a2a/v1/messages                  # 接收外部 Agent 消息
GET    /a2a/v1/stream/{message_id}       # 流式拉回答（SSE）
POST   /a2a/v1/threads                   # 开启对话 thread
GET    /a2a/v1/agent-facts/{agent_did}   # 公开 AgentFacts
```

所有 A2A 端点都要 HTTP Message Signature 验证。

## .well-known endpoints

```
GET    /.well-known/did.json                # 主 DID document
GET    /.well-known/agents.json             # 本实例所有公开 Agent 列表
GET    /.well-known/openid-configuration    # 未来：OIDC 兼容（v2）
```

## Webhooks（可选，v1.5+）

让外部系统订阅事件：

```
POST   /api/v1/webhooks
GET    /api/v1/webhooks
DELETE /api/v1/webhooks/{id}
```

支持的事件：`message.new.peer`、`permission.granted`、`thread.archived`。

## 限流策略

| 路由 | 限制 |
|---|---|
| `/api/v1/auth/login` | 10/分钟 per IP |
| `/api/v1/auth/register` | 3/小时 per IP |
| `/api/v1/conversations/*/messages` POST | 60/分钟 per user |
| `/a2a/v1/*` | 100/分钟 per peer-domain（白名单更高） |
| WSS | 单用户最多 10 个并发连接 |

限流响应：

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
Content-Type: application/json

{ "error": { "code": "rate_limited", "message": "Too many requests" } }
```

## 咨询 API（用户发起的 A2A 出站）

让用户（或代表用户的 MCP server）主动向**已是联系人**的 peer agent 发问并取回异步回复。签名与投递全在 gateway 内完成，私钥不出 gateway。

> 与"会话 API"的区别：`/api/v1/conversations` + `/api/v1/stream` 是与**自己的本地 LLM 助手**对话；`/api/v1/consult` 才是经 A2A 发给**别人的 agent**。

### POST `/api/v1/consult/:peerId`

发起或续聊一个 `type='consult'` 会话（每个 peer 复用同一会话），签名并投递 `message.type='question'`。

```jsonc
// 请求体（consultRequestSchema）
{ "question": "如何轮换密钥？", "code_context": "...可选代码...", "language": "zh" }
```

| 响应 | 含义 |
|------|------|
| `201 { conversation_id, message_id, status: "sent" }` | 已签名投递 |
| `502 { ..., status: "failed", error }` | 投递失败（peer 离线 / 无 endpoint / 验签问题） |
| `403 not_a_contact` | peer 不是当前用户的联系人 |

### GET `/api/v1/consult/:conversationId/reply?after=:messageId&wait=:seconds`

长轮询等待 peer 的异步回复（peer 经入站 `/a2a/v1/messages` 携 `thread_id` 返回，gateway 按 `thread_id` 挂回本线程）。`wait` 上限 55s。

- `200 { status: "answered", message }` — 收到回复
- `200 { status: "pending" }` — 超时仍无回复，可稍后再轮询

### GET `/api/v1/consult/:conversationId`

返回该咨询线程的完整消息历史（最多 200 条）。

> 契约：入站 A2A 仅对 `message.type==='question'` 触发本地 agent 自动回复；`answer`/`notification` 只落库 + 广播，避免咨询回复触发无限对答。
