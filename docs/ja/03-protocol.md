# Confer — プロトコル設計

Confer インスタンス間、ならびにユーザークライアントとサーバー間のすべてのプロトコルを定義します。すべてのプロトコルはオープン標準に基づいており、将来のフェデレーション化を容易にします。

## Agent のアイデンティティ

### DID:web 形式

各ユーザー/企業インスタンスは、自身の DID document をホストします。

```
https://acme.com/.well-known/did.json
```

DID document の構造（W3C DID v1.0 互換）:

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

ユーザー Agent の DID 形式: `did:web:acme.com:agents:laowang` —— メインインスタンス + パスセグメント。これにより、1 つのインスタンスで複数のユーザーをホストできます。

### 鍵のローテーション

- DID document は複数の verification method の宣言をサポートし、スムーズなローテーションを実現します
- 旧鍵は少なくとも 30 日間保持します（処理中のリクエストが失敗するのを防ぐため）
- 失効は、document から verification method を削除することで行います

## AgentFacts (NANDA-compatible)

各 Agent は、自身を記述する AgentFacts を 1 部公開します。場所:

```
https://acme.com/agents/{slug}/agent.json
```

または well-known の総目録:

```
https://acme.com/.well-known/agents.json
```

構造例:

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

フィールド説明:

- `capabilities`: この Agent が何をできるかを宣言します。Claude Code は `scope` フィールドを使ってキーワードルーティングを行います（X100 関連のコードを書く際に自動的にこの Agent へ相談する）
- `languages`: サポートする言語。翻訳ポリシーに使用します
- `trust.verifiedBy`: サードパーティによる信頼のエンドースメント（オプション、将来 NANDA が提供）
- `publicKey`: A2A 通信の署名用公開鍵

## A2A プロトコル

### プロトコル層

すべての A2A 通信は HTTPS POST/GET を経由し、JSON でエンコードします。

**重要: bearer token ではなく HTTP Message Signatures（RFC 9421）を使用します**。その理由:

- Bearer token は傍受されると無効化されます
- HTTP signature は具体的なリクエストに紐付きます（method + path + body digest + タイムスタンプ）
- リプレイ不可能で、署名検証だけで送信者の身元を確認できます

### インバウンドリクエストの例

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

### 検証フロー（受信側）

1. `Signature` header をパースする
2. `keyId`（DID を含む）を抽出する
3. DID document を取得する（キャッシュ付き: ETag + 60s TTL）
4. 公開鍵を取り出し、signature を検証する
5. `Digest` が body のハッシュと一致することを検証する
6. `Date` が 5 分以内であることをチェックする（リプレイ防止）
7. `Capability` token を検証する（macaroon スタイル、後述）
8. **接続同意ゲート**: 送信者は受信側の連絡先としてすでに追加されているか? 未接続 → LLM を実行せず、接続リクエストとして保留する（後述）
9. 接続済み → policy engine を経由して、応答するかどうかを決定する

### Capability token

Capability token により、送信側 Agent は「私は X ユーザーを代表して Y 種類の質問をしに来た」ことを表明でき、権限を細粒度で制限できます。

JWT スタイルですが、macaroon の考え方を採用しています:

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

- `scope`: どの種類の質問ができるか
- `delegation_depth`: 代理として何回転送されたか（無限の伝播を防止）

### レスポンスのストリーミング出力

LLM が回答を生成するのはストリーミング形式であり、A2A も SSE をサポートします:

```http
GET /a2a/v1/stream/{message_id} HTTP/1.1
Host: acme.com
Signature: ...
```

`text/event-stream` を返します:

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

## 権限モデル（Claude Code-inspired）

権限を 3 段階に階層化します:

### L1 - 自動（確認不要）

- 自分の Agent が自分自身の資料を読む
- 相手の Agent が自身のドキュメントを引用して質問に答える
- Agent 間の純粋なクエリ型の対話（副作用なし、データ共有なし）

### L2 - 一度だけ確認

- あるディレクトリ/ファイルを相手の Agent に共有する
- 相手の Agent に自分の対話コンテキストを見せる
- インスタンスをまたいでデータを転送する
- あるツールを有効化する（初回有効化）

UI の表現: 権限カードをポップアップ表示し、4 つの選択肢を提示:
- 今回のみ許可
- 常に許可（peer + 範囲に限定）
- 詳細を見る
- 拒否

### L3 - 明示的同意（毎回確認）

- 自分の Agent が私の代わりに招待を受諾、支払い、契約締結を行う
- 不可逆な操作（削除、送金、対外的なコミットメント）
- 金額/法律に関わるコミットメント

UI の表現: モーダルポップアップ + 詳細な操作リスト + カウントダウン（誤クリック防止）。

### Standing policies

ユーザーはあらかじめルールを設定し、デフォルトの挙動を上書きできます:

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

### 接続同意ゲート（consent gate）

A2A メッセージに 1 件回答すると、**受信側**の LLM 予算を消費します。見知らぬ Agent が持ち主の知らないうちに大量のメッセージを送りつけ、持ち主の token を浪費するのを防ぐため、接続を消費の前提条件とします:

- **接続済みの peer**（受信側の `peer_contacts` 内にいる）→ 接続済みであれば同意とみなし、policy engine に入って通常どおり処理します。
- **未接続の peer** → `POST /a2a/v1/messages` は `202` を返し、body は `{ "status": "pending_connection" }` となります。**会話を作成せず、メッセージを保存せず、LLM も実行しません**。同時に、`action='connect'` の承認待ち接続リクエストを 1 件 pending inbox に記録します（peer 単位で重複排除し、重複メッセージで埋め尽くされないようにします）。
- 持ち主は権限受信箱で「ある Agent が接続の確立を要求 + 最初のメッセージ」を確認し、**承認**すると `peer_contacts` に書き込まれ（接続が確立され）、以降その peer のメッセージは通常どおり処理されます。**拒否**すると接続は確立されません。

モデルの形態は LinkedIn / 企業フェデレーションに対応します: **発見層はオープン**（誰でも `agents.json`、AgentFacts を読める）、**インタラクション層は同意が必要**（接続後でなければ相手の計算リソースを消費できない）。

「接続済み」になるには 2 つの経路があります:
1. 受信側が能動的に `POST /contacts/lookup` → `POST /contacts` を通じてその peer を追加する。
2. peer が先に起点となり、受信側が受信箱でその接続リクエストを承認する。

### Pending inbox（オフライン代理応答）

持ち主がオフラインのときに**接続済み** peer からの質問を受け取った場合:

- standing policy に合致するもの → Agent が直接回答する
- ホワイトリストにないもの → pending inbox に保留し、持ち主がオンラインになったときにワンクリックで承認/編集/拒否する
- 緊急度の高いもの → 持ち主に push 通知する

## フェデレーション発見

### ドメイン名検索

ドメイン名 `acme.com` を入力すると、クライアントは:

1. `https://acme.com/.well-known/did.json` を取得してメインの DID を得る
2. `https://acme.com/.well-known/agents.json` を取得して、そのドメイン配下のすべての公開 Agent を一覧表示する
3. その中から 1 つ選んで連絡先として追加する

### 公共レジストリ（v2+）

NANDA Index または類似の公共レジストリに接続し、以下をサポートします:

- capability で検索（「Modbus がわかる Agent を探す」）
- organization で検索（「ABC 工業の Agent を探す」）
- 地理的位置で検索（「近くのサービス Agent」）

### 信頼グラフ（v2+）

- 自分の友人の Agent が上位にランクされる
- 自分の同僚の会社の Agent が上位にランクされる
- サードパーティのエンドースメント（NANDA が検証済みのもの）には信頼バッジが付く

## スパム対策

- peer-domain ごとに 1 分あたりのレート制限（Redis counter）
- ホワイトリストにない peer はデフォルトで低優先度
- ユーザーは特定の peer-domain をブロックできる
- Reputation スコア（v2+）: いくつの他インスタンスから spam とマークされたか

## 翻訳ポリシー

- 各 Agent は AgentFacts で `primary_language` と `style` を宣言する
- 言語をまたぐ対話: 翻訳は**ターゲット Agent の内部**で行う（自身の用語とドキュメントを最もよく理解しているため）
- 引用部分は**常に原文を保持**する: ユーザーは翻訳前の権威ある記述を確認できる
- デフォルトの挙動は `preserve-style`（スタイルを保持し、言語のみ切り替える）。消費シーンでは `localize-style`（郷に入っては郷に従う）を宣言できる

## プロトコル進化ポリシー

- すべてのプロトコルは `@context` または `version` フィールドを持つ
- クライアント/サーバーともに後方互換性を確保する（未知のフィールドを受け入れ、未知のフィールドを無視する）
- Breaking change は major version bump（例: `/a2a/v2/`）を通じて行う
- NANDA、Google A2A の schema 進化と互換性を保つ（オープンエコシステムに賭ける）
