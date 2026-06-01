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
PUT    /api/v1/agents/me/llm-keys      # 加密存储 LLM API keys
```

### 联系人 / Peer Agents

```
GET    /api/v1/contacts                     # 列出联系人
POST   /api/v1/contacts                     # 添加联系人
GET    /api/v1/contacts/{contact_id}
DELETE /api/v1/contacts/{contact_id}
PATCH  /api/v1/contacts/{contact_id}        # 修改 alias, tags, pinned 等

POST   /api/v1/contacts/lookup              # 按 DID / 域名 / username 查找
```

`POST /api/v1/contacts/lookup` 请求:

```json
{
  "method": "domain",          // domain | did | username | qr_code | phone
  "value": "abc-industries.com"
}
```

响应：返回找到的候选 Agent 列表。lookup 会把发现到的 peer **落库到 `peer_agents`** 并在每个候选里带上本地 `id`（`peer_id`）——`POST /api/v1/contacts` 正是用这个 `id` 添加联系人。`POST /contacts` 幂等：重复添加同一 peer 返回已存在的联系人（`200`）而非报错。

> 添加联系人是**接收方授予对方"可消费我的 Agent"的同意**：被加为联系人的 peer 才能触发我的 Agent 回答（消耗我的 LLM 预算）。未连接 peer 发来的 A2A 消息会被挂起为待批连接请求，见 `03-protocol.md` 的「连接同意闸门」。

```
POST   /api/v1/contacts/{contact_id}/policies   # 设置 standing policies
```

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

待批请求里 `action='connect'` 的是**连接请求**（陌生 peer 首次接触时由 A2A 入站生成）。批准（`allow_*`）会把该 peer 写入 `peer_contacts`，建立连接；拒绝则不建立。`GET /pending` 为每条请求附带 `description`（含发起方与首条留言）便于主人判断。

### 项目记忆（Claude Code 集成相关）

```
GET    /api/v1/projects/{project_id}/peers              # 该项目下注册的 peer
POST   /api/v1/projects/{project_id}/peers
GET    /api/v1/projects/{project_id}/peers/{peer_id}/facts
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/facts
GET    /api/v1/projects/{project_id}/peers/{peer_id}/decisions
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/decisions
```

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
    "description": "Agent 想分享 src/modbus/ 给 ABC Agent（12 个文件）",
    "requested_at": "2024-11-15T14:30:00Z"
  }
}
```

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
