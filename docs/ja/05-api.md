# Confer — API 仕様

クライアント ↔ サーバー、サーバー ↔ A2A peer のすべての API を定義する。

## 共通規約

- Base URL: `https://{instance}/api`
- エンコーディング: JSON、UTF-8
- 時刻形式: ISO 8601、UTC（`2024-11-15T14:30:00Z`）
- ID: ULID（`01HXKQ7Z2N3M4P5R6T7Y8Z9A0B`）
- エラー形式:

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
- access token の TTL は 15 分、refresh token の TTL は 90 日
- 2 つのトークンは `typ` クレーム（`access` / `refresh`）で区別され、**互いに代用できない**。`Authorization` ヘッダーは `access` しか受け取らず、`POST /auth/refresh` は `refresh` しか受け取らない。以前は `exp` しか違わなかったため、refresh token は認証が要るすべてのエンドポイントで 90 日間の通行証になり、access token の 15 分は有名無実だった
- refresh は毎回ローテーションし、`sessions.refresh_token_hash` と照合する。合わなければ再利用とみなし、セッション全体を無効化する。`sessions.expires_at` はセッションの**絶対**上限であり、ローテーションでは延びない
- トークンはクライアントのローカルストレージに置く。HTTP-only cookie ではない（クライアントは Tauri のデスクトップアプリで、same-origin cookie に相当するものが存在しない）

## クライアント API（ユーザークライアントが使う）

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
GET    /api/v1/agents/me/llm-keys      # 各 provider が設定済みかどうか（真偽値のみを返し、鍵は返さない）
PUT    /api/v1/agents/me/llm-keys      # LLM の API キーを暗号化して保存
DELETE /api/v1/agents/me/llm-keys/{provider}
GET    /api/v1/agents/me/llm-keys/{provider}/models   # ベンダーに直接、利用できるモデルを問い合わせる
```

`provider` の値は `@confer/shared` の provider カタログ（`packages/shared/src/llm/catalog.ts`）から来る。加えてツールサービスの `tavily`。このカタログは gateway、agent-runtime、クライアントの三者が読む。base URL、モデル一覧のパス、既定モデルはその一箇所にしか書かれていないので、ベンダーの追加はカタログを直すだけで済む。

`/models` はベンダー自身のモデル一覧をそのまま転送し、ローカルで維持した一覧は決して返さない:

```jsonc
{ "models": [{ "id": "gpt-4o" }] }
// 空の一覧は必ず理由を伴う。4 つは互いに異なり、それぞれ取るべき手当ても違う
{ "models": [], "error": "no_key" }        // この provider にはまだ鍵が設定されていない
{ "models": [], "error": "unauthorized" }  // ベンダーがその鍵を拒否した（401/403）
{ "models": [], "error": "unreachable" }   // ベンダーに到達できない、または別のエラーが返った
{ "models": [], "error": "unsupported" }   // この provider はモデル一覧のエンドポイントを提供していない
```

### 連絡先 / Peer Agent

```
GET    /api/v1/contacts                     # 連絡先の一覧。ページング: ?limit=&offset=
POST   /api/v1/contacts                     # 連絡先を追加
GET    /api/v1/contacts/{contact_id}        # 連絡先 1 件の詳細（peer 付き）
DELETE /api/v1/contacts/{contact_id}
PATCH  /api/v1/contacts/{contact_id}        # alias / tags / pinned / muted の部分更新（渡さなかった項目は消えない）

POST   /api/v1/contacts/lookup              # DID / ドメイン / ユーザー名で検索
```

`POST /api/v1/contacts/lookup` リクエスト:

```json
{
  "method": "domain",          // domain | did | username | qr_code | phone
  "value": "abc-industries.com"
}
```

`GET /api/v1/contacts` は `{ contacts, total }` を返す。`limit` は既定 50・上限 100、`offset` は既定 0。並び順は `id`（ULID）の降順、つまり新しいものが先頭になる。並びが一意で決定的であることこそが、offset の窓が行を飛ばしたり重複させたりするのを防いでいる。`total` はこのページの件数ではなく全件数で、クライアントはこれで「末尾に着いた」と判断する。解釈できない `limit`/`offset` はエラーにせず既定値を採る。

レスポンス: 見つかった候補 Agent の一覧。lookup は発見した peer を **`peer_agents` に永続化**し、各候補にローカルの `id`（`peer_id`）を付ける。`POST /api/v1/contacts` はまさにその `id` で連絡先を追加する。`POST /contacts` は冪等で、同じ peer を重ねて追加してもエラーではなく既存の連絡先（`200`）が返る。

> 連絡先の追加は、**受け手が相手に「自分の Agent を消費してよい」と与える同意**である。連絡先として追加された peer だけが、私の Agent に回答させ（私の LLM 予算を使わせ）られる。未接続の peer から届いた A2A メッセージは、承認待ちの接続リクエストとして保留される。`03-protocol.md` の「接続同意のゲート」を参照。

```
POST   /api/v1/contacts/{contact_id}/policies   # standing policy を設定（全体置換、PUT セマンティクス）
```

`POST /contacts/{id}/policies` の body は runtime 形の `{ default?: 'allow'|'ask_user'|'deny', rules?: [{ action, peer_did?, decision }] }` で、まるごと `peer_contacts.policy_overrides_json` に書き込まれる。**マージのセマンティクス**: 受信 A2A の判定時、この contact 単位の上書きが agent レベルの policy に重なる。`contact.default` があれば agent の既定を置き換え、`contact.rules` は agent の rules の前に置かれるので先にマッチする（contact 単位の具体的な規則が agent の一般規則に優先する）。空の上書き `{}` は恒等で、上書きが無い場合の判定とバイト単位で一致する。

### 対話

```
GET    /api/v1/conversations                       # 自分の対話一覧（ホーム画面用）
POST   /api/v1/conversations                       # 対話を作成
GET    /api/v1/conversations/{id}
PATCH  /api/v1/conversations/{id}
DELETE /api/v1/conversations/{id}

GET    /api/v1/conversations/{id}/messages         # ページング: ?before=&limit=
POST   /api/v1/conversations/{id}/messages         # メッセージを送る
GET    /api/v1/conversations/{id}/messages/{msg_id}/stream    # LLM の返答を SSE でストリーム受信

POST   /api/v1/conversations/{id}/participants     # participant を追加
DELETE /api/v1/conversations/{id}/participants/{p_id}

POST   /api/v1/conversations/{id}/read             # 既読にする
```

`POST /api/v1/conversations/{id}/messages` リクエスト:

```json
{
  "content_type": "text",
  "content": "X100 のレジスタ 0x40 にはどのファンクションコードを使いますか？",
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
GET    /api/v1/permissions/pending               # 未処理の L2/L3 リクエスト
POST   /api/v1/permissions/{id}/decide           # 承認 / 拒否
GET    /api/v1/permissions/history               # 履歴
```

`POST /api/v1/permissions/{id}/decide` リクエスト:

```json
{
  "decision": "allow_always",       // allow_once | allow_always | deny | deny_always
  "scope": "peer_action"            // 判断の適用範囲
}
```

未処理リクエストのうち `action='connect'` のものは**接続リクエスト**である（見知らぬ peer が初めて接触したときに A2A の受信経路が生成する）。承認（`allow_*`）するとその peer が `peer_contacts` に書き込まれて接続が成立し、拒否すれば成立しない。

`action='ask'` のものは**接続済み peer からの保留中の質問**で、その質問に対して Agent の policy が `ask_user` と判定したときに A2A の受信経路が生成する（`03-protocol.md` の「Pending inbox（不在時の代理応答）」を参照）。承認（`allow_*`）すると Agent が保留中の質問に答え、拒否すれば答えない。

`GET /pending` は各リクエストに `description` を付ける（接続リクエストには発信者と最初のメッセージ、質問には発信者と質問本文）。持ち主が判断できるようにするためである。

### プロジェクト記憶（Claude Code 連携まわり）

```
GET    /api/v1/projects/{project_id}/peers              # このプロジェクトで記憶を持つ peer（join で name/did も）  ✅ 実装済み
POST   /api/v1/projects/{project_id}/peers              # peer をプロジェクトに明示登録   🔜 backlog
GET    /api/v1/projects/{project_id}/peers/{peer_id}/facts        # ✅ 実装済み
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/facts        # ✅ 実装済み
GET    /api/v1/projects/{project_id}/peers/{peer_id}/decisions    # ✅ 実装済み
PUT    /api/v1/projects/{project_id}/peers/{peer_id}/decisions    # ✅ 実装済み
```

セマンティクスの補足（v0.1）:

- すべてのクエリは `user.sub` にスコープされる（ユーザー間の分離）。
- PUT の前に、その peer がそのユーザーの連絡先か（`peer_contacts`）を検証する。連絡先でなければ `403 not_a_contact` を返す。
- PUT は upsert で、初回の書き込みで `version=1`、以降は `version` が増え `updated_at` が更新される。`facts` と `decisions` は独立しており、一方の section を書いても他方は消えない。
- その (project, peer) にまだ記憶が無い場合、`GET facts/decisions` は `200` と空文字列と `version:0` を返す（404 ではない。「この peer にはまだ蓄積が無い」は読み取りでは正常な状態だから）。
- `project_id` は `^[a-zA-Z0-9._\-/]+$`（1–255 文字）で検証し、不正なら `400 invalid_project_id` を返す。
- 空のプロジェクトでは `GET peers` は空配列を返す。(project, peer) の関係は facts/decisions の PUT によって暗黙に作られる（今期は `POST peers` による明示登録は行わない）。

### ナレッジベース（RAG）

```
GET    /api/v1/knowledge-bases                                  # 自分のナレッジベース一覧
POST   /api/v1/knowledge-bases                                  # 新規作成
PATCH  /api/v1/knowledge-bases/{kb_id}                          # 名前・説明の変更、および外部 Agent への公開可否
DELETE /api/v1/knowledge-bases/{kb_id}                          # 所属する全ドキュメントとベクトルごと削除

GET    /api/v1/knowledge-bases/{kb_id}/documents                # ページング: ?limit=&offset=
POST   /api/v1/knowledge-bases/{kb_id}/documents                # multipart upload、フィールド名は file
DELETE /api/v1/knowledge-bases/{kb_id}/documents/{doc_id}
POST   /api/v1/knowledge-bases/{kb_id}/documents/{doc_id}/retry # 再取り込み
```

`POST /knowledge-bases` の body は `{ name, description? }`（`name` は 1–255 文字）で、`201` と `{ knowledge_base }` を返す。

`PATCH /knowledge-bases/{kb_id}` の body は `{ name?, description?, shared_with_peers? }` で、`{ knowledge_base }` を返す。**`shared_with_peers` はここでしか変更できず、作成時には受け付けない**。ナレッジベースは必ず「自分だけ」で生まれ、外部への公開は second の、意図的な操作である。

`shared_with_peers` が決めるのは**受信した A2A の質問がこのベースを検索できるかどうか**で、既定は `false`。持ち主自身がウェブで対話するときには影響せず、常に全部を検索できる。この境界は必ず検索のスコープ側に置かねばならず、プロンプトに書いてはならない。相手の質問も持ち主の指示も、モデルにとっては同じ種類のテキストとして届くのだから、「言ってよいかは Agent が判断する」は境界を成さない。同じ理由で、受信した A2A の質問は**長期記憶を一切リコールしない**。長期記憶は持ち主自身の対話から蒸留されたものであり、このインスタンスの外へ出てよいと印の付いた項目は 1 件も無い。

`GET /knowledge-bases` は `{ knowledge_bases }` を返し、**ページングしない**。ユーザーのベースは手作業で作るもので、件数に上限がある。

`GET /{kb_id}/documents` は `{ documents, total }` を返す。`limit` は既定 50・上限 100、`offset` は既定 0。`id`（ULID）の降順、つまり新しいものが先頭。並びが一意で決定的であることが、offset の窓が行を飛ばしたり重複させたりするのを防ぐ。`total` はこのページの件数ではなく全件数。解釈できない `limit`/`offset` はエラーにせず既定値を採る。この節で唯一、際限なく増えうる一覧である。アップロードの行き先がまさにナレッジベースだからだ。

アップロードは `multipart/form-data`。ファイルのフィールド名は常に `file` で、1 ファイルの上限は **10 MB**（超えると `400 bad_request`）。`Content-Type` はフォームにあればそれを使い、無ければ拡張子から推測する。レスポンスは `201` と `{ document }` で、その時点で `status` はすでに `processing` である。**チャンク分割・ベクトル化・Qdrant への書き込みはレスポンスの後に非同期で走り**、アップロードのエンドポイントはその完了を待たない。クライアントは `status` が変わるまでドキュメント一覧をポーリングする。

`status` の値:

| 値 | 意味 |
|---|---|
| `processing` | 取り込み済みで、分割・ベクトル化の最中。アップロード後と retry 後の初期状態 |
| `ready` | 検索できる。`chunk_count` はそのドキュメントの分割数 |
| `failed` | 取り込み失敗（解析、embedding キーの欠如、またはベクトルストアへの書き込み失敗） |

`POST /{doc_id}/retry` はオブジェクトストレージから元ファイルを取り戻して再取り込みする。先にそのドキュメントの既存ベクトルを消すので、分割が重複することはない。元ファイルが失われている（`storage_key` が空）場合や、ドキュメントがまだ `processing` の場合は `400` を返す。レスポンスは `{ document }` で、`status` は `processing` に戻り `chunk_count` はゼロになる。

ナレッジベースの削除は、その全ドキュメント行と Qdrant のベクトルにカスケードする。単一ドキュメントの削除では、ベクトルとオブジェクトストレージ上の元ファイルも併せて片付ける。ベクトルやオブジェクトの片付けに失敗しても DB の削除は止めない。削除済みデータを指す行を残すより、孤児オブジェクトを残すほうがましだからである。

すべてのエンドポイントは `user.sub` にスコープされる。他人の kb やドキュメントにアクセスすると `404` を返す（`403` ではない。存在そのものを漏らさないため）。

> リバースプロキシは 10 MB のリクエストボディを通す必要がある。`infra/nginx.conf` は `/api/` に `client_max_body_size 10m` を設定している。nginx 既定の 1 MB のままだと、1–10 MB のファイルは gateway に届きすらせず、ブラウザは nginx 自身の 413 ページを受け取る。

### ファイル添付

```
POST   /api/v1/attachments                       # multipart upload
GET    /api/v1/attachments/{id}                  # ダウンロード（署名付き URL へ 302 リダイレクト）
DELETE /api/v1/attachments/{id}
```

## WebSocket

### エンドポイント

```
WSS  /ws?token=<access_token>&device_id=<device_id>
```

ハンドシェイクの認証は REST と完全に同じで、「署名が通れば通す」ではない。`typ` は `access` でなければならず、`sid` はまだ存在するセッションを指していなければならず、アカウントは `disabled` であってはならない。3 つとも欠かせない。これらが無ければ、凍結されたアカウントもトークンが失効していない限り再接続してメッセージを受け取り続けられる一方、凍結そのもの（全セッションの削除）はこの経路では何も取り消せない。凍結は同時に、そのユーザーが**すでに開いている socket も閉じる**。nginx は `/ws` の `proxy_read_timeout` に 1 日を与えているので、次のハンドシェイクを止めても既に繋がっている接続は止まらない。

### メッセージ形式

WS のメッセージはすべて JSON で、`type` フィールドを持つ:

```json
{ "type": "message.new", "data": { /* ... */ } }
```

### クライアント → サーバー

```
ping                          // ハートビート
subscribe.conversation        // 対話を購読（サーバー側で参加者かどうかを検証）
unsubscribe.conversation
typing.start                  // 購読済みの対話にのみ効く
typing.stop
read.ack                      // 既読確認
```

`typing.*` のブロードキャストは、その socket の購読集合に従う。購読にゲートがあって打鍵イベントに無い場合、対話 id を 1 つ知っているだけで、任意の対話に「誰それが入力中」を——しかも自分のユーザー名付きで——注入できてしまう。

### サーバー → クライアント

```
pong
message.new                   // 新着メッセージ
message.updated
message.deleted
typing.update                 // 誰が入力中か
presence.update               // 連絡先のオンライン・オフライン
permission.request            // ユーザーの判断を要する権限リクエスト
agent.status                  // 自分の Agent が何をしているか（「ABC の Agent に相談中…」）
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
    "content": "0x03 Read Holding Registers を使います…",
    "citations": [
      {
        "source": "X100 通信マニュアル v3.2",
        "page": 87,
        "url": "https://acme.com/manuals/x100-v3.2.pdf#page=87",
        "trust_level": "authoritative"
      }
    ],
    "language": "ja",
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

**ペイロードに `description` は無い。これは意図的である。** サーバーは読み手の言語を知らないので、構造化された事実（`action` + peer の身元 + 保存済みの `scope`）だけを送り、承認時に読まれる文はクライアントが i18n で組み立てる（`packages/client/src/lib/permission-text.ts`）。この契約は `@confer/shared` の `permissionRequestEventSchema` が単独で所有する。gateway は送信前にこれで parse し、クライアントは受信後にこれで parse する。

`GET /api/v1/permissions/pending` の各行も同じ形（加えて `decision` フィールド）で、同じコンストラクタから生成される。したがってポーリングで得た行と socket が押し出した行はバイト単位で一致する。

## SSE (LLM streaming)

```
GET  /api/v1/conversations/{id}/messages/{msg_id}/stream
Accept: text/event-stream
```

イベント種別:

```
event: token
data: {"text":"0x03 "}

event: token
data: {"text":"0x03 "}

event: tool_call
data: {"tool":"agent_network.ask_peer","args":{...}}

event: tool_result
data: {"result":"..."}

event: citation
data: {"source":"X100 通信マニュアル v3.2","page":87}

event: done
data: {"finish_reason":"stop","tokens_used":523}
```

## A2A API（対外。他の Confer インスタンスが呼ぶ）

詳細は `docs/03-protocol.md`。ここではエンドポイントのみ列挙する。

2 つのバインディングが同じ prefix の下に共存し、同じゲート群（`a2a/inbound.ts`）を通る。異なるのはワイヤ形式だけである。

**A2A 標準 HTTP+JSON バインディング**（パスは仕様 §11.3 をそのまま写したもの。Agent Card が宣言するのはこちら）:

```
POST   /a2a/v1/message:send              # SendMessage → Task
GET    /a2a/v1/tasks/{id}                # GetTask
GET    /a2a/v1/tasks                     # ListTasks（カーソルページング）
POST   /a2a/v1/tasks/{id}:cancel         # CancelTask → TaskNotCancelable
POST   /a2a/v1/message:stream            # 未実装 → UnsupportedOperation
POST   /a2a/v1/tasks/{id}:subscribe      # 未実装 → UnsupportedOperation
GET    /a2a/v1/extendedAgentCard         # 未実装 → UnsupportedOperation
*      /a2a/v1/tasks/{id}/pushNotificationConfigs…  # → PushNotificationNotSupported
```

**Confer 独自の方言**（インスタンス間で使う。`/.well-known/agents.json` から発見される）:

```
POST   /a2a/v1/messages                  # 外部 Agent のメッセージを受け取る
GET    /a2a/v1/stream/{message_id}       # 回答をストリームで取得（SSE）
GET    /a2a/v1/agent-facts/{agent_did}   # 公開 AgentFacts
```

すべての A2A エンドポイントで HTTP Message Signature の検証を要求する。

## .well-known endpoints

```
GET    /.well-known/did.json                # 主 DID document
GET    /.well-known/agents.json             # このインスタンスの全公開 Agent 一覧
GET    /.well-known/agent-card.json         # A2A 標準 Agent Card（公開 Agent がちょうど 1 つのときのみ）
GET    /.well-known/openid-configuration    # 将来: OIDC 互換（v2）
```

## A2A 標準 Agent Card（相互運用のための発見層）

```
GET    /agents/{username}/agent-card.json   # その Agent の A2A 標準 Card
GET    /.well-known/agent-card.json         # 同上。このインスタンスの公開 Agent がちょうど 1 つのときのみ
```

Linux Foundation の **Agent2Agent v1.0** の `AgentCard` に従う（フィールドは `a2aproject/A2A` の `specification/a2a.proto` @ v1.0.1 から。proto3 の JSON マッピングなので camelCase）。目的は A2A エコシステムにこのインスタンスの Agent を**発見**させることにある。名前は重なっていたのに プロトコル が噛み合わなかった——相手側の発見ドキュメントは `/.well-known/agent-card.json` にあり、このインスタンスには `/.well-known/agents.json` しか無かったからだ。

いくつかの意図的な取捨:

- **Agent 1 つにつき Card 1 枚**。`supportedInterfaces[].tenant` はユーザー名。仕様の well-known は 1 ドメインに 1 Agent を前提にしているが、このインスタンスはマルチテナントである。`tenant` はまさに、仕様が「1 つの A2A エンドポイントの背後に複数の Agent」のために定義したルーティング用セレクタだ。`/.well-known/agent-card.json` は**公開 Agent がちょうど 1 つ**のときだけ応答し（単独セルフホストの場合）、そうでなければ 404 を返してエラーメッセージで `agents.json` を指す。適当なアカウントを 1 つ選んで「このドメインの Agent」と称するのは誤りだからである。
- **`streaming: false`**。ストリーミングのエンドポイントは確かに存在するが、それは Confer 独自の形であって仕様の `SendStreamingMessage` ではない。標準クライアントが使えない能力を宣言するのは、宣言しないよりも悪い。
- **`securitySchemes` は宣言しない**。仕様がそこで用意しているのは API キー / HTTP auth / OAuth2 / OIDC / mTLS だが、このエンドポイントはそのどれも受け取らない。求めているのは署名されたリクエストである。適当に 1 つ埋めるのは、必ず拒否される方法で認証してよいとクライアントに告げるに等しい。本当の要求は**必須拡張**（`capabilities.extensions`。`uri` は RFC 9421 のアドレス、`required: true`）として宣言する。仕様がこのために用意した機構がまさにこれだ。
- Card は**発見ドキュメント**であり、その可視性は `/.well-known/agents.json` と完全に同じである。非公開または停止中の Agent は一律 404。そうでなければこの経路が、持ち主が公開するつもりの無かったアカウントを列挙する手段になってしまう。

- **宣言するバインディングは 1 つだけ**。Confer 独自の方言も同じ URL の下にあるが、Card には書かない。§5.1 は Agent が宣言する各バインディングが機能的に等価であることを要求しており、方言には task のライフサイクルが無いからだ。方言は `/.well-known/agents.json` から発見される。Card には果たせない約束を 1 つも残さない。

### メッセージ層（Task セマンティクス）

`POST /a2a/v1/message:send` は仕様の `SendMessageRequest` を受け取り、`Task` を返す。**1 つの task は 1 回の受信質問そのものである**。`id` はそのメッセージの id、`contextId` はそれを保管する対話であり、状態はその後に起きたことから導出される。同じ事実を影として持つ `tasks` テーブルを別に立てたりはしない。

Confer の非同期 + 同意ゲートのモデルは、仕様のステートマシンにちょうど乗る:

| 状況 | 状態 |
|---|---|
| Agent が回答中 | `TASK_STATE_WORKING` |
| 回答完了 | `TASK_STATE_COMPLETED` |
| このターンがそもそも動かない（モデル未設定、または provider がエラー） | `TASK_STATE_FAILED` |
| `ask_user` の policy で保留、持ち主の承認待ち | `TASK_STATE_AUTH_REQUIRED`（中断状態であって終端ではない） |
| 持ち主が拒否した | `TASK_STATE_REJECTED` |

返すべき task が**存在しない**ケースが 2 つある。行がそもそも作られないからだ——見知らぬ peer（承認待ちの接続リクエストとして保留される）と、policy による直接の拒否である。どちらも `403 PERMISSION_DENIED` を返し、`ErrorInfo.metadata.confer_status` で区別する。次の呼び出しで 404 になる task id をでっち上げるほうが悪い。

残りの挙動も仕様と 1 つずつ揃えてある。エラーボディは `google.rpc.Status` の形で、`ErrorInfo.reason` を**必ず**伴う（複数の A2A エラーが同じ HTTP ステータスコードを共有しており、reason だけが唯一の識別手段だから）。必須拡張を宣言していないクライアントには §3.3.4 に従って `ExtensionSupportRequiredError` を返す。何も説明しない 401 ではない。`historyLength=0` は**フィールドごと省略する**ことであって、空配列を送ることではない。`nextPageToken` は常に存在し、次ページが無いときは空文字列になる。

意図的な逸脱が 2 つあり、どちらもコードのコメントに書いてある。ブロッキングの `message:send` の待ちには**上限がある**（55 秒。その後は `WORKING` のままの task を返してクライアントにポーリングさせる）——§3.2.2 はタイムアウトの出口を用意しておらず、一方で LLM 呼び出しには上界が無い。そして `messageId` による冪等性（§3.3.1 の MAY）は**実装していない**。テナント安全な一意キーには owner のスコープが要るのに、最初のメッセージのワイヤ形式からはそれが取れないからである。

## Webhooks（任意、v1.5+）

外部システムがイベントを購読できるようにする:

```
POST   /api/v1/webhooks
GET    /api/v1/webhooks
DELETE /api/v1/webhooks/{id}
```

対応イベント: `message.new.peer`、`permission.granted`、`thread.archived`。

## レート制限ポリシー

| ルート | 制限 |
|---|---|
| `/api/v1/auth/login` | 10/分 per IP |
| `/api/v1/auth/register` | 3/時 per IP |
| `/api/v1/conversations/*/messages` POST | 60/分 per user |
| `/a2a/v1/*` | 100/分 per peer-domain（ホワイトリストはより高い） |
| WSS | 1 ユーザーあたり同時接続は最大 10 |

制限に掛かったときのレスポンス:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
Content-Type: application/json

{ "error": { "code": "rate_limited", "message": "Too many requests" } }
```

## 相談 API（ユーザー発の A2A 送信）

ユーザー（またはユーザーを代行する MCP サーバー）が、**すでに連絡先になっている** peer agent に自分から質問し、非同期の返答を後から受け取れるようにする。署名と配送はすべて gateway 内で完結し、秘密鍵は gateway の外に出ない。

> 「対話 API」との違い: `/api/v1/conversations` + `/api/v1/stream` は**自分のローカル LLM アシスタント**との会話であり、`/api/v1/consult` は A2A で**他人の agent** に送るものである。

### POST `/api/v1/consult/:peerId`

`type='consult'` の対話を開始または継続し（peer ごとに同じ対話を再利用する）、`message.type='question'` に署名して配送する。

```jsonc
// リクエストボディ（consultRequestSchema）
{ "question": "鍵はどうやってローテーションしますか？", "code_context": "…任意のコード…", "language": "ja" }
```

| レスポンス | 意味 |
|------|------|
| `201 { conversation_id, message_id, status: "sent" }` | 署名して配送済み |
| `502 { ..., status: "failed", error }` | 配送失敗（peer がオフライン / endpoint が無い / 署名の問題） |
| `403 not_a_contact` | peer が現在のユーザーの連絡先ではない |

### GET `/api/v1/consult/:conversationId/reply?after=:messageId&wait=:seconds`

peer の非同期返答をロングポーリングで待つ（返答は受信側の `/a2a/v1/messages` に `thread_id` を伴って届き、gateway がそれを元のスレッドに掛け戻す）。`wait` の上限は 55 秒。

- `200 { status: "answered", message }` — 返答が届いた
- `200 { status: "pending" }` — タイムアウトしたが返答は無い。後でまたポーリングしてよい

### GET `/api/v1/consult/:conversationId`

その相談スレッドの全メッセージ履歴を返す（最大 200 件）。

> 契約: 受信 A2A がローカル agent の自動返答を起動するのは `message.type==='question'` のときだけ。`answer`/`notification` は保存とブロードキャストのみで、相談の返答が無限の応酬を引き起こさないようにしてある。
