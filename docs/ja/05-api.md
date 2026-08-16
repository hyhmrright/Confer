# Confer — API 仕様

クライアント ↔ サーバー、サーバー ↔ A2A peer 間のすべての API を定義する。

## 共通規約

- Base URL: `https://{instance}/api`
- エンコーディング: JSON, UTF-8
- 時刻フォーマット: ISO 8601, UTC（`2024-11-15T14:30:00Z`）
- ID: ULID (`01HXKQ7Z2N3M4P5R6T7Y8Z9A0B`)
- エラーフォーマット:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Human-readable message",
    "details": { /* optional */ }
  }
}
```

## 認証

- ユーザークライアント: `Authorization: Bearer <jwt_access_token>`
- Access token TTL: 15 分
- Refresh token TTL: 90 日、HTTP-only cookie に保存

## クライアント API（ユーザークライアントが使用）

### 認証

```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
POST   /api/v1/auth/oauth/{provider}    # OAuth callback
```

`POST /api/v1/auth/login` リクエスト:

```json
{
  "username": "laowang",
  "password": "...",
  "device_id": "ios-abc123",
  "device_info": { "platform": "ios", "model": "iPhone 15", "os": "17.1" }
}
```

レスポンス:

```json
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "expires_in": 900,
  "user": { /* User object */ }
}
```

### ユーザーと Agent の設定

```
GET    /api/v1/users/me
PATCH  /api/v1/users/me
GET    /api/v1/agents/me
PATCH  /api/v1/agents/me
PUT    /api/v1/agents/me/policies
PUT    /api/v1/agents/me/llm-keys      # 加密存储 LLM API keys
```

### 連絡先 / Peer Agents

```
GET    /api/v1/contacts                     # 連絡先一覧。ページング: ?limit=&offset=
POST   /api/v1/contacts                     # 添加联系人
GET    /api/v1/contacts/{contact_id}
DELETE /api/v1/contacts/{contact_id}
PATCH  /api/v1/contacts/{contact_id}        # 修改 alias, tags, pinned 等

POST   /api/v1/contacts/lookup              # 按 DID / 域名 / username 查找
```

`POST /api/v1/contacts/lookup` リクエスト:

```json
{
  "method": "domain",          // domain | did | username | qr_code | phone
  "value": "abc-industries.com"
}
```

`GET /api/v1/contacts` は `{ contacts, total }` を返す。`limit` は既定 50・上限 100、`offset` は既定 0。`id`（ULID）の降順、つまり新しい順で並ぶ——順序が一意かつ決定的であることが、offset ウィンドウで行を取りこぼしたり重複させたりしないための条件である。`total` はページ内ではなく全体の件数なので、クライアントは「打ち切られた一覧」と「完全な一覧」を区別できる。解釈できない `limit`/`offset` はエラーにせず既定値を用いる。

レスポンス: 見つかった候補 Agent のリストを返す。lookup は発見した peer を **`peer_agents` にDB保存**し、各候補にローカルの `id`（`peer_id`）を付与する——`POST /api/v1/contacts` はまさにこの `id` を使って連絡先を追加する。`POST /contacts` は冪等で、同じ peer を重複追加すると既存の連絡先を返す（`200`）。エラーにはならない。

> 連絡先の追加は、**受信側が相手に「自分の Agent を消費できる」同意を付与すること**である。連絡先として追加された peer だけが、自分の Agent に回答をトリガーできる（自分の LLM 予算を消費する）。未接続の peer から届いた A2A メッセージは、承認待ちの接続リクエストとして保留される。`03-protocol.md` の「接続同意ゲート」を参照。

```
POST   /api/v1/contacts/{contact_id}/policies   # 设置 standing policies
```

### 会話

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

`POST /api/v1/conversations/{id}/messages` リクエスト:

```json
{
  "content_type": "text",
  "content": "X100 寄存器 0x40 用什么功能码？",
  "in_reply_to": null,
  "via": "web"
}
```

レスポンス:

```json
{
  "id": "01HXKQ...",
  "delivery_status": "queued",
  "stream_url": "/api/v1/conversations/01HX.../messages/01HXK.../stream"
}
```

### 権限管理

```
GET    /api/v1/permissions/pending               # 待处理的 L2/L3 请求
POST   /api/v1/permissions/{id}/decide           # 批准/拒绝
GET    /api/v1/permissions/history               # 历史记录
```

`POST /api/v1/permissions/{id}/decide` リクエスト:

```json
{
  "decision": "allow_always",       // allow_once | allow_always | deny | deny_always
  "scope": "peer_action"            // 限定范围
}
```

承認待ちリクエストのうち `action='connect'` のものは**接続リクエスト**である（見知らぬ peer が初めて接触した際に A2A 受信側で生成される）。承認（`allow_*`）するとその peer が `peer_contacts` に書き込まれ、接続が確立される。拒否すると確立されない。`GET /pending` は各リクエストに `description`（発起者と最初のメッセージを含む）を付与し、オーナーが判断しやすいようにする。

### プロジェクトメモリ（Claude Code 連携関連）

```
GET    /api/v1/projects/{project_id}/peers              # 该项目下注册的 peer
POST   /api/v1/projects/{project_id}/peers
GET    /api/v1/projects/{project_id}/peers/{peer_id}/facts
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/facts
GET    /api/v1/projects/{project_id}/peers/{peer_id}/decisions
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/decisions
```

### ナレッジベース（RAG）

```
GET    /api/v1/knowledge-bases                                  # 自分のナレッジベース一覧
POST   /api/v1/knowledge-bases                                  # 新規作成
DELETE /api/v1/knowledge-bases/{kb_id}                          # 配下の全ドキュメントとベクトルも削除

GET    /api/v1/knowledge-bases/{kb_id}/documents                # ページング：?limit=&offset=
POST   /api/v1/knowledge-bases/{kb_id}/documents                # multipart upload、フィールド名は file
DELETE /api/v1/knowledge-bases/{kb_id}/documents/{doc_id}
POST   /api/v1/knowledge-bases/{kb_id}/documents/{doc_id}/retry # 再取り込み
```

`POST /knowledge-bases` のボディは `{ name, description? }`（`name` は 1〜255 文字）、`201` + `{ knowledge_base }` を返します。`GET /knowledge-bases` は `{ knowledge_bases }` を返し、**ページングしません**：ナレッジベースは手動で作るものなので件数に上限があります。

`GET /{kb_id}/documents` は `{ documents, total }` を返します。`limit` は既定 50・上限 100、`offset` は既定 0。`id`（ULID）の降順、つまり新しい順です——並び順が決定的かつ一意であることが、offset ウィンドウで行が飛んだり重複したりしない条件です。`total` はこのページの件数ではなく全件数です。解釈できない `limit`/`offset` はエラーにせず既定値を使います。ナレッジベースはまさにアップロード先なので、ここで唯一無制限に増えるリストです。

アップロードは `multipart/form-data`、ファイルのフィールド名は `file` 固定、1 ファイル **10 MB** まで（超過は `400 bad_request`）。`Content-Type` はフォームに含まれていればそれを、なければ拡張子から推測します。レスポンスは `201` + `{ document }` で、この時点で `status` は既に `processing` です：**チャンク分割・ベクトル化・Qdrant への書き込みはレスポンス後に非同期で走り**、アップロード API はその完了を待ちません。クライアントは `status` が変わるまでドキュメント一覧をポーリングします。

`status` の値：

| 値 | 意味 |
|---|---|
| `processing` | 保存済みで、分割・ベクトル化の実行中。アップロードと retry 直後の初期状態 |
| `ready` | 検索可能。`chunk_count` はそのドキュメントのチャンク数 |
| `failed` | 取り込み失敗（パース、embedding キー欠如、ベクトルストアへの書き込み） |

`POST /{doc_id}/retry` はオブジェクトストレージから原本を取り直して再取り込みします。既存のベクトルを先に削除してから実行するため、チャンクが重複することはありません。原本が失われている（`storage_key` が空）場合や、まだ `processing` の場合は `400` を返します。レスポンスは `{ document }` で、`status` は `processing` に、`chunk_count` は 0 に戻ります。

ナレッジベースの削除は配下のドキュメント行と Qdrant のベクトルまで連鎖します。単一ドキュメントの削除では、ベクトルとオブジェクトストレージ上の原本も併せて片付けます。ベクトルやオブジェクトの後始末に失敗しても DB の削除は止めません——孤児オブジェクトが残るほうが、削除済みデータを指す行が残るよりましだからです。

すべてのエンドポイントは `user.sub` にスコープされます：他人の kb やドキュメントに触れると、存在を漏らす `403` ではなく `404` を返します。

> リバースプロキシ側で 10 MB のボディを通す必要があります。`infra/nginx.conf` は `/api/` に `client_max_body_size 10m` を設定しています。nginx 既定の 1 MB のままだと 1〜10 MB のファイルは gateway に届かず、ブラウザには nginx 自身の 413 ページが返ります。

### ファイル添付

```
POST   /api/v1/attachments                       # multipart upload
GET    /api/v1/attachments/{id}                  # 下载（302 redirect 到签名 URL）
DELETE /api/v1/attachments/{id}
```

## WebSocket

### エンドポイント

```
WSS  /ws?token=<access_token>&device_id=<device_id>
```

### メッセージフォーマット

すべての WS メッセージは JSON であり、`type` フィールドを含む:

```json
{ "type": "message.new", "data": { /* ... */ } }
```

### クライアント → サーバー

```
ping                          // 心跳
subscribe.conversation        // 订阅某个对话
unsubscribe.conversation
typing.start
typing.stop
read.ack                      // 已读确认
```

### サーバー → クライアント

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

`message.new` の例:

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

`permission.request` の例:

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

**ペイロードに `description` は含まれません。これは意図的です。** サーバーは読み手の言語を
知らないため、構造化された事実（`action` + peer の識別情報 + 保存済みの `scope`）のみを送り、
承認カードに表示される文章はクライアント側が i18n で組み立てます
（`packages/client/src/lib/permission-text.ts`）。この契約は `@confer/shared` の
`permissionRequestEventSchema` が単独で所有し、送信側・受信側の双方がこれで parse します。

`GET /api/v1/permissions/pending` の各行も同じ形状（加えて `decision` フィールド）で、
同一のビルダーが生成するため、ポーリングで取得した行と socket で push された行は完全に一致します。

## SSE（LLM streaming）

```
GET  /api/v1/conversations/{id}/messages/{msg_id}/stream
Accept: text/event-stream
```

イベントタイプ:

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

## A2A API（対外向け、他の Confer インスタンスから呼び出される）

詳細は `docs/03-protocol.md` を参照。ここではエンドポイントのみを列挙する。

```
POST   /a2a/v1/messages                  # 接收外部 Agent 消息
GET    /a2a/v1/stream/{message_id}       # 流式拉回答（SSE）
POST   /a2a/v1/threads                   # 开启对话 thread
GET    /a2a/v1/agent-facts/{agent_did}   # 公开 AgentFacts
```

すべての A2A エンドポイントは HTTP Message Signature の検証を必要とする。

## .well-known endpoints

```
GET    /.well-known/did.json                # 主 DID document
GET    /.well-known/agents.json             # 本实例所有公开 Agent 列表
GET    /.well-known/openid-configuration    # 未来：OIDC 兼容（v2）
```

## Webhooks（オプション、v1.5+）

外部システムがイベントを購読できるようにする:

```
POST   /api/v1/webhooks
GET    /api/v1/webhooks
DELETE /api/v1/webhooks/{id}
```

サポートされるイベント: `message.new.peer`、`permission.granted`、`thread.archived`。

## レート制限ポリシー

| ルート | 制限 |
|---|---|
| `/api/v1/auth/login` | 10/分 per IP |
| `/api/v1/auth/register` | 3/時間 per IP |
| `/api/v1/conversations/*/messages` POST | 60/分 per user |
| `/a2a/v1/*` | 100/分 per peer-domain（ホワイトリストはより高い） |
| WSS | 1 ユーザーあたり最大 10 の同時接続 |

レート制限レスポンス:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
Content-Type: application/json

{ "error": { "code": "rate_limited", "message": "Too many requests" } }
```

## コンサルテーション API（ユーザー発起の A2A アウトバウンド）

ユーザー（またはユーザーを代理する MCP server）が、**すでに連絡先となっている** peer agent に能動的に問い合わせを行い、非同期の返信を取得できるようにする。署名と配信はすべて gateway 内で完結し、秘密鍵は gateway の外に出ない。

> 「会話 API」との違い: `/api/v1/conversations` + `/api/v1/stream` は**自分のローカルの LLM アシスタント**との対話であり、`/api/v1/consult` こそが A2A 経由で**他人の agent**へ送るものである。

### POST `/api/v1/consult/:peerId`

`type='consult'` の会話を開始または継続し（peer ごとに同一の会話を再利用）、署名して `message.type='question'` を配信する。

```jsonc
// 请求体（consultRequestSchema）
{ "question": "如何轮换密钥？", "code_context": "...可选代码...", "language": "zh" }
```

| レスポンス | 意味 |
|------|------|
| `201 { conversation_id, message_id, status: "sent" }` | 署名して配信済み |
| `502 { ..., status: "failed", error }` | 配信失敗（peer オフライン / endpoint なし / 署名検証の問題） |
| `403 not_a_contact` | peer が現在のユーザーの連絡先ではない |

### GET `/api/v1/consult/:conversationId/reply?after=:messageId&wait=:seconds`

peer の非同期返信をロングポーリングで待機する（peer は受信側の `/a2a/v1/messages` 経由で `thread_id` を携えて返信し、gateway が `thread_id` に従って本スレッドに紐付け直す）。`wait` の上限は 55s。

- `200 { status: "answered", message }` — 返信を受信
- `200 { status: "pending" }` — タイムアウトしても返信がない場合。後でもう一度ポーリングできる

### GET `/api/v1/consult/:conversationId`

このコンサルテーションスレッドの完全なメッセージ履歴を返す（最大 200 件）。

> 契約: 受信側の A2A は `message.type==='question'` に対してのみローカル agent の自動返信をトリガーする。`answer`/`notification` はDB保存とブロードキャストのみを行い、コンサルテーション返信が無限の応答ループをトリガーするのを防ぐ。
