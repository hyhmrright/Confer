# Confer — システムアーキテクチャ

## 高レベルアーキテクチャ

```
┌────────────────────────────────────────────────────────────┐
│  Clients (Tauri 2.0)                                       │
│  iOS · Android · Windows · macOS · Linux                   │
└──────────────────────────┬─────────────────────────────────┘
                           │ WSS / HTTPS / SSE
                           ▼
┌────────────────────────────────────────────────────────────┐
│  Edge API Gateway  (Bun + Hono)                            │
│  Auth · Rate limit · Routing · WS fan-out                  │
└─────┬─────────────┬─────────────────┬────────────────┬─────┘
      │             │                 │                │
      ▼             ▼                 ▼                ▼
 ┌────────┐  ┌─────────────┐  ┌────────────┐  ┌──────────────┐
 │ Agent  │  │Conversation │  │ Identity & │  │ MCP / Tools  │
 │Runtime │  │     Hub     │  │A2A Gateway │  │  Connector   │
 └───┬────┘  └──────┬──────┘  └─────┬──────┘  └──────┬───────┘
     │              │               │                │
     ▼              ▼               ▼                ▼
┌──────────────────────────────────────────────────────────────┐
│  Data layer: PostgreSQL · Redis · NATS · Vector (Qdrant)·S3 │
└──────────────────────────────────────────────────────────────┘
       │                              │
       ▼                              ▼
 LLM providers              Other instances' Agents
 (Claude / GPT /            (federation via A2A
  DeepSeek / Qwen)           over HTTPS)
```

## 設計原則

- **Stateless edge, stateful core**：ゲートウェイはステートレスで水平スケールが可能。Agent runtime はユーザー単位でシャーディングし、状態は PG/Redis に保持
- **Federation-ready from day 1**：DID:web 身分 + AgentFacts を採用し、単一インスタンスでもフェデレーションプロトコルに従って動作するため、将来のフェデレーション化の移行コストはゼロ
- **BYO LLM key**：プラットフォームは LLM コストを負担せず、ユーザーは自身の API key を使用する
- **プロトコルファースト**：コアとなるやり取りはオープンプロトコル（A2A、MCP、DID:web、NANDA AgentFacts）で行い、自社の独自プロトコルに縛られない
- **Bun + TypeScript フルスタック**：バックエンドは Bun + Hono、クライアントは Tauri + React で、型を共有できる

## サービス境界

### 1. Edge API Gateway

`docs/05-api.md` を参照。

- **責務**：TLS 終端、ユーザー/A2A の二重身分検証、4 次元レート制限、HTTP/WS/SSE ルーティング、マルチデバイス fan-out
- **技術スタック**：Bun + Hono
- **主要依存**：JWKS（ユーザー token 検証）、DID document cache、NATS（fan-out）
- **担当しないこと**：ビジネスロジック、ビジネスデータの永続化、LLM の呼び出し

### 2. Agent Runtime

各ユーザーは常駐の Agent インスタンスを 1 つ持つ。

- **責務**：
  - ユーザー Agent の状態（model 選択、tools、policy、memory）を維持する
  - LLM 呼び出しループ（マルチ provider 抽象化）
  - MCP クライアントとして、ユーザーがインストールしたツールサーバーに接続する
  - A2A アウトバウンド呼び出し（相手の Agent と話をしに行く）
  - ポリシーエンジン（相手に何を伝えてよいかを判断する）
- **ライフサイクル**：オンデマンドで起動する。メッセージが届くか A2A リクエストが到来したときに、PG から状態をロードし、1 ラウンドを実行して書き戻す。
- **主要依存**：LLM providers、MCP servers、Identity service

### 3. Conversation Hub

- **責務**：メッセージの保存、購読、プッシュ
- **サポートする対話タイプ**：
  - ユーザー ↔ 自分の Agent
  - ユーザー ↔ 相手の Agent（自分の Agent 経由で中継）
  - ユーザー ↔ ユーザー（通常の IM）
  - グループチャット（ユーザー + Agent の混在）
- **主要依存**：NATS Streams（永続化 + ファンアウト）、PG（履歴メッセージ）、Redis（presence、未読件数）

### 4. Identity & A2A Gateway

- **責務**：
  - ユーザーの DID:web ドキュメントを管理する
  - AgentFacts を公開しキャッシュする
  - インバウンド A2A リクエストを処理する（HTTP signature、capability token の検証）
  - アウトバウンド A2A リクエストを転送する
  - フェデレーション peer のレート制限とスパム対策
- **主要依存**：PG（DID/peer キャッシュ）、Redis（counter レート制限）

詳細なプロトコル設計は `docs/03-protocol.md` を参照。

### 5. MCP / Tools Connector

- **責務**：
  - ユーザーがインストールした MCP ツールサーバーの接続管理
  - Agent runtime はここを通じてツールを呼び出す
  - ツール呼び出し結果の標準化されたラッピング
- **主要依存**：`@modelcontextprotocol/sdk`

## データ層

| コンポーネント | 用途 |
|---|---|
| PostgreSQL | ユーザー、Agent、対話、メッセージ、権限、peer 関係（メインストレージ） |
| Redis | session、presence、レート制限カウンタ、ホットデータキャッシュ |
| NATS Streams | メッセージのファンアウト（user.{uid}.events）+ Agent runtime のタスクキュー |
| Qdrant または pgvector | Agent の長期記憶 RAG、ユーザー資料庫のインデックス |
| S3-compatible (MinIO) | ファイル添付、DID document のバックアップ、対話アーカイブ |

## クライアントアーキテクチャ

- **ベース**：Tauri 2.0（Rust カーネル + WebView レンダリング）
- **フロントエンド**：React 18 + TypeScript + Tailwind CSS
- **状態管理**：Zustand または Jotai（軽量）
- **ルーティング**：TanStack Router
- **ネットワーク**：ネイティブ fetch + native WebSocket + EventSource (SSE)
- **ローカルストレージ**：Tauri が提供する SQLite + key-value store（対話のキャッシュ、オフラインメッセージの下書き）

### クロスプラットフォーム対応

| プラットフォーム | 実現方法 |
|---|---|
| iOS | Tauri 2.0 iOS support |
| Android | Tauri 2.0 Android support |
| Windows | Tauri 2.0 |
| macOS | Tauri 2.0 |
| Linux | Tauri 2.0 |

単一のコードベースで、ネイティブ fallback はなし。

### Claude Code プラグイン

`docs/06-claude-code-plugin.md` を参照。

- 独立した MCP server プロセスで、Node.js / Bun で実装
- ユーザーは `claude mcp add confer <command>` でインストールする
- OAuth / token を通じてユーザーの Confer アカウントと紐付ける

## デプロイアーキテクチャ

### 単一インスタンス（個人/小規模チーム）

```
docker-compose.yml:
  - gateway       (Bun 服务)
  - agent-runtime (Bun 服务)
  - conversation  (Bun 服务)
  - identity      (Bun 服务)
  - postgres
  - redis
  - nats
  - qdrant
  - minio
  - caddy / traefik  (反向代理 + TLS)
```

デプロイ方法：`docker compose up -d` を実行すればそのまま使える。

### エンタープライズインスタンス

- 上記と同じ Docker Compose で独立したデプロイを 1 つ立ち上げる
- 自社のドメイン（`acme.com`）を使用する
- `https://acme.com/.well-known/did.json` と `https://acme.com/.well-known/agent.json` を公開する
- 内部ユーザーは SSO ログインを利用する

### クラウド（Confer 自社クラウド）

- Kubernetes マルチテナント
- 各ユーザー/企業は自分の namespace または schema を持つ
- LLM provider 抽象化レイヤを共有する（ただしユーザー自身の key を使い続ける）
- グローバルマルチリージョンデプロイで、最寄りのリージョンに接続する

## フェデレーション化（インスタンス間）

任意の Confer インスタンス（自前構築またはクラウド）は、A2A プロトコルを通じて他のインスタンスと相互通信できる。

```
[acme.com]              [vendor-x.com]            [confer.cloud]
 Agent A    <─── A2A ───> Agent B    <─── A2A ───> Agent C
```

身分と発見：

- 各インスタンスは `/.well-known/did.json` で DID document を公開する
- 各 Agent は `/.well-known/agent.json` で AgentFacts を公開する
- インスタンス間検索：既知のインスタンス + 公開レジストリへ fan-out する

## 可観測性

- **Tracing**：OpenTelemetry。trace_id を gateway で注入し、すべてのサービスを貫通させる
- **ログ**：JSON 構造化、Vector / Loki で収集
- **メトリクス**：Prometheus。主要メトリクス：
  - `gateway_active_ws_connections{user_id}`
  - `agent_runtime_llm_tokens_total{provider,role}`
  - `a2a_inbound_requests_total{peer_domain,status}`
  - `mcp_tool_calls_total{tool,result}`

## セキュリティ境界

- ユーザー ↔ gateway：JWT + JWKS 検証
- A2A peer ↔ gateway：HTTP Message Signatures (RFC 9421) + DID:web 公開鍵
- サービス間の内部 RPC：mTLS または共有 secret（Docker network 内）
- LLM provider 呼び出し：API key を暗号化保存（AES-256、key は Vault / KMS に保持）
- ユーザーファイルストレージ：S3 server-side encryption

## 主要な技術的意思決定

| 意思決定 | 選択 | 候補 | 理由 |
|---|---|---|---|
| バックエンド言語 | Bun + TypeScript | Go | MCP/A2A SDK が TS-first；フルスタックで型を共有できる |
| Web フレームワーク | Hono | Elysia, Fastify | 軽量・高速・エコシステムが安定 |
| クライアント | Tauri 2.0 | Flutter, Electron | 単一コードベースで 5 プラットフォーム、Rust による安全性、サイズが小さい |
| メインストレージ | PostgreSQL 16 | MySQL | JSON サポートが良好、拡張性が高い、pgvector も選択可能 |
| メッセージバス | NATS | Kafka, Redis Pub/Sub | 軽量・永続化・正確な購読 |
| ベクトルストア | Qdrant | Pinecone, pgvector | セルフホストが成熟、Rust 製でパフォーマンスが安定 |
| 身分 | DID:web | DID:key, OAuth-only | web インフラと互換、NANDA が推奨 |
| プロトコル | A2A + MCP + AgentFacts | 独自プロトコル | オープンプロトコルのエコシステムに賭ける |
