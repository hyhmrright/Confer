# Confer — MVP ロードマップとバックログ

milestone ごとにスライスし、各 milestone は提供可能でデモ可能なバージョンとする。

## v0.1 — Core proof of concept（4〜6 週間）

**目標**：単一マシンで「ユーザー ↔ 自分の Agent ↔ 相手の Agent」の全フローを通せること。

**Scope（必須）**：

- [ ] バックエンド：gateway + agent runtime + conversation + identity（4 サービス、単一プロセスでも独立でも可）
- [ ] PostgreSQL schema（04-data-model.md を参照）を migration ツールで管理
- [ ] ユーザー登録 / ログイン（パスワードログインのみで十分、OAuth/passkey は不要）
- [ ] DID:web ドキュメントの生成と公開（`/.well-known/did.json`）
- [ ] AgentFacts ドキュメントの生成と公開
- [ ] A2A プロトコルの入站と出站（HTTP signature 検証 + capability token 検証）
- [ ] Agent runtime：LLM 呼び出しループ（まずは Claude と DeepSeek の 2 つの provider のみ対応）
- [ ] シンプルなポリシーエンジン：whitelist peer + 全許可 / 全拒否
- [ ] クライアント：単一の Tauri アプリ、デスクトップ 3 プラットフォームを先に（Linux / macOS / Windows、モバイルは後期）
- [ ] クライアントでできること：ログイン / 連絡先追加（DID で追加）/ 1 対 1 の対話 / 引用の表示
- [ ] WebSocket リアルタイムメッセージ配信（単一インスタンスで十分、NATS fan-out は不要）
- [ ] SSE ストリーミング LLM 出力
- [ ] Docker Compose によるワンコマンドでのローカル開発環境起動

**Out of scope**：

- グループチャット、マルチ device fan-out、モバイル、多言語 UI、CDN、外部 OAuth、複雑なポリシー
- Claude Code プラグインはまだここには含めない

**Acceptance**：

2 人の開発者がローカルでそれぞれ 1 つの Confer インスタンスを起動し、互いに友達追加し、互いに対話し、引用を表示できること。

---

## v0.2 — Claude Code プラグイン MVP（3〜4 週間）

**目標**：Claude Code の中で peer Agent に相談でき、回答がプロジェクトに蓄積されること。

**Scope**：

- [ ] MCP server の実装。`ask_peer`、`list_peers`、`read_project_memory`、`write_project_memory` の 4 つのツールを提供
- [ ] OAuth-style での Confer アカウントと Claude Code インスタンスの紐付け
- [ ] `.claude/confer.toml` 設定ファイルのパース
- [ ] `.claude/peers/{slug}/` ディレクトリの読み書き（facts.md, decisions.md, conversations/, meta.json）
- [ ] 自動事実抽出：ask_peer 後に回答から構造化された事実を抽出して facts.md に書き込む
- [ ] `confer` CLI ツール（add peer, list peers, ask, sync）
- [ ] 開発者がテストするための 1 つの demo peer Agent（mock-vendor.confer.dev）

**Acceptance**：

開発者が `claude mcp add confer` をインストールし、設定後に Claude Code 内で mock vendor に質問でき、回答に引用が付き、`.claude/peers/mock-vendor/facts.md` に書き込まれ、git に commit され、次の session で自動的にロードされること。

---

## v0.3 — グループチャットと企業インスタンス（4〜5 週間）

**目標**：グループチャット（ユーザー + Agent の混在）に対応し、1 台のマシン上に「企業インスタンス」をデプロイできること。

**Scope**：

- [ ] グループチャットのデータモデルと UI
- [ ] グループメンバー管理（人と Agent の追加 / 削除）
- [ ] 複数の @ Agent が同時に回答（折りたたみ表示、「採用」メカニズム）
- [ ] 企業インスタンス：カスタムドメイン、SSO ログイン（OIDC で可）
- [ ] 連絡先の発見：ドメインで検索（acme.com を入力すると、そのドメインが公開する Agent を自動的に検索）
- [ ] マルチデバイス fan-out（NATS の導入）
- [ ] モバイル（iOS、Android）

**Acceptance**：

5 人の小チーム + 2 Agent が 1 つのグループでプロジェクトの議論を行い、体験がスムーズであること。1 つの会社が自前で Confer インスタンスを構築し、外部に公開 Agent を公開して、他のインスタンスから検索されること。

---

## v0.4 — 多言語とオフライン代理応答（3 週間）

**目標**：プロダクトを国際化シナリオと半非同期コミュニケーションに役立つものにすること。

**Scope**：

- [ ] UI i18n（中国語、英語からスタート、日独仏を予約）
- [ ] Agent 間のクロス言語対話（翻訳はターゲット Agent の内部で完了し、引用は原文を保持）
- [ ] AgentFacts に `primary_language` フィールドを追加
- [ ] オフライン代理応答：standing policy 設定 UI + pending inbox + push notification
- [ ] Pre-flight design review ツールを MCP server に追加
- [ ] Post-flight code review ツールを MCP server に追加

**Acceptance**：

中国の開発者が中国語でドイツのベンダーの Agent（ドイツ語 docs）に質問し、中国語の回答 + ドイツ語の原文引用を得られること。standing policy を設定した後、オフライン時に Agent がルールに合致するリクエストを正しく処理し、不確実なものを保留にできること。

---

## v1.0 — 本番対応（4〜6 週間）

**目標**：本番環境で利用でき、商用サポートを提供できること。

**Scope**：

- [ ] 完全な可観測性（OTel tracing、Prometheus metrics、Loki logs）
- [ ] バックアップとリストア（PG 物理バックアップ + S3 増分）
- [ ] セキュリティ監査（重要な操作に audit log）
- [ ] 細分化されたレート制限（4 次元すべてを実装）
- [ ] LLM 使用量ダッシュボード（per-Agent の月次コスト）
- [ ] BYO LLM key の完全な UX（暗号化保存、ローテーション、クォータ）
- [ ] ドキュメントサイト（ユーザー利用マニュアル、自前デプロイマニュアル、API リファレンス）
- [ ] パブリックな Confer Cloud インスタンスの公開（`cloud.confer.ai`）

**Acceptance**：

少なくとも 100 登録ユーザー、10 個の独立した peer Agent のデプロイ、単一インスタンスが 30 日以上安定稼働すること。

---

## v1.5+ — グロースとエコシステム（継続）

**Scope**：

- [ ] 公開 Agent ディレクトリ（NANDA Index への接続）
- [ ] 信頼グラフとレピュテーションシステム
- [ ] 個人向け C 端バージョン（より軽量な UI）
- [ ] Reputation-based のスパム対策
- [ ] Webhooks（サードパーティシステム連携）
- [ ] ユーザーあたり複数 Agent（1 ユーザーが複数の専門 Agent を持つ）
- [ ] ブラウザ拡張機能（Web ページ上で Agent を呼び出す）

---

## タスク粒度（Claude Code 向け）

各 milestone を 50〜200 個の小タスクに分割する。各タスクは：

1. 明確な入出力を持つ
2. テスト可能な acceptance criteria を持つ
3. 1 開発者-日を超えない作業量

例えば v0.1 のタスクの一部のサンプル：

### バックエンドの骨格

- [ ] monorepo の作成（pnpm workspaces または Bun workspaces）
- [ ] `packages/shared`：共有型定義（zod または valibot を使用）
- [ ] `packages/gateway`：Bun + Hono アプリの骨格
- [ ] `packages/agent-runtime`：Agent 状態機の骨格
- [ ] `packages/conversation`：メッセージ保存 / 配信サービス
- [ ] `packages/identity`：DID + AgentFacts + A2A 検証
- [ ] PostgreSQL migration ツール（drizzle-kit または prisma）
- [ ] すべてのデータテーブルの migration ファイルの作成

### データベース層

- [ ] User CRUD（登録、ログイン、個人情報の取得）
- [ ] Agent CRUD（自分の Agent の作成、設定の変更）
- [ ] PeerAgent CRUD（連絡先の追加、取得、削除）
- [ ] Conversation CRUD + Participant 管理
- [ ] Message CRUD + ページネーション
- [ ] Permission テーブルの書き込みとクエリ

### 身元とプロトコル

- [ ] DID document 生成（user ごとに ed25519 keypair を作成）
- [ ] `/.well-known/did.json` endpoint
- [ ] AgentFacts 生成と endpoint
- [ ] HTTP signature 署名器（出站）
- [ ] HTTP signature 検証器（入站）
- [ ] Capability token の発行と検証
- [ ] DID document fetcher + cache

### LLM 抽象化

- [ ] LLM provider interface（chat, stream, tools）
- [ ] Claude provider の実装
- [ ] DeepSeek provider の実装
- [ ] API key の暗号化保存（Vault / env）
- [ ] Per-Agent model config の適用

### Agent runtime

- [ ] Agent 状態機：load → process → save ループ
- [ ] LLM 呼び出しループ + tool calling
- [ ] シンプルなポリシーエンジン（whitelist + allow/deny）
- [ ] A2A 出站呼び出し（Agent が他者にメッセージを送る）
- [ ] A2A 入站処理（他者の Agent からメッセージを受け取る）

### Gateway と API

- [ ] JWT 発行 / 検証 middleware
- [ ] すべての `/api/v1/auth/*` endpoints
- [ ] すべての `/api/v1/conversations/*` endpoints
- [ ] WebSocket handler（購読、メッセージ送信）
- [ ] SSE handler（LLM ストリーミング出力）
- [ ] A2A inbound endpoints + signature 検証 middleware
- [ ] レート制限 middleware（まずはシンプル版：固定ウィンドウ）

### クライアント

- [ ] Tauri 2.0 プロジェクトの初期化
- [ ] ログイン / 登録ページ
- [ ] メイン画面：左側に連絡先リスト + 右側に対話
- [ ] 連絡先追加ダイアログ（DID またはドメインで）
- [ ] 対話メッセージリスト（ストリーミングレンダリング）
- [ ] 引用カプセルのレンダリング
- [ ] 権限リクエストカードのレンダリング
- [ ] WebSocket 接続管理
- [ ] ローカル SQLite で直近 100 件のメッセージをキャッシュ

### Demo コンテンツ

- [ ] mock-vendor の Agent のデプロイ（デモ用）
- [ ] X100 mock マニュアル（数ページの PDF を RAG データとして）
- [ ] デモ video / ドキュメント：友達追加から回答取得までのエンドツーエンドのフロー

---

## リスクと必要な早期の意思決定

| リスク | 緩和策 |
|---|---|
| MCP SDK はまだ進化中で、API が breaking になる可能性 | stable 版を使用し、changelog を monitor し、適応層を作る |
| A2A プロトコル（Google）と NANDA 標準はいずれもまだ進化中 | 最小サブセットでスタートし、プロトコル適応層を予約 |
| Tauri 2.0 の iOS / Android はまだ比較的新しく、落とし穴を踏む可能性 | MVP 段階ではデスクトップ 3 プラットフォームのみとし、モバイルは v0.3 で対応 |
| LLM コストの制御不能 | デフォルトクォータ + 明示的な BYO key + 使用量ダッシュボードを早めに作る |
| 国内 LLM provider 連携（DeepSeek/Qwen）の SDK が不安定 | OpenAI 互換インターフェース（これらの provider はすべて対応）を統一的な接続ポイントとして使用 |

## Claude Code 向けの実装ヒント

1. **集成より先にユニットテストを作る**：各 service はそれ自身でテストを実行でき、他の service の起動に依存しないこと
2. **データベースの migration は migration ツールを通す**、手書き SQL を書かない
3. **types の共有は `@confer/shared` パッケージを通す**、フロントエンドとバックエンドで共用
4. **各 PR にはドキュメント変更を伴わせる**（プロトコルや API を変更した場合）
5. **A2A プロトコルの実装は既存ライブラリを優先する**（例えば `http-message-signatures` npm パッケージ）、車輪の再発明をしない
6. **DID:web の実装は `did-resolver` + `did-jwt`** といった W3C ツールを優先する
7. **MCP server は公式 SDK を優先する** (`@modelcontextprotocol/sdk`)
8. **commit message は conventional commits を使う** (feat:, fix:, docs:, etc.)
