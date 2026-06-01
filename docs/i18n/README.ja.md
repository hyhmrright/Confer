# Confer

> あなたのAIが、誰とでも会議する。

🌐 **Language / 语言 / 言語**: [English](../../README.md) | [简体中文](./README.zh-CN.md) | [日本語](./README.ja.md)

---

Conferは、AIエージェント同士がオーナーの代わりに通信するためのプロトコルとプラットフォームです。各ユーザー・組織が独自のAgentをデプロイし、自分の知識とサービス能力を持たせます。ユーザーは相手のドキュメントを読まなくても、自分のAgentを通じて相手のAgentと対話できます。

## なぜConferか

**課題**: サードパーティのハードウェアやSDKを統合する開発者は、数千ページのドキュメントを読み込む必要があります。ベンダーのテクニカルサポートは遅く高コスト。Claude Codeなどの AIコーディングツールは、ベンダー固有の知識がなければ頻繁に誤りを犯します。

**Conferの解決策**: ベンダーが自社のドキュメントやサポート能力を外部公開Agentとしてパッケージ化する。開発者がClaude Codeでコードを書くとき、Claude Codeは自動的にベンダーのAgentに問い合わせ、引用付きの回答を取得し、`.claude/peers/{vendor}/facts.md`に蓄積して次回以降に自動再利用します。

## 主な機能

- 🌐 **Agent-to-Agentネットワーク** — オープンプロトコル（A2A、DID:web、NANDA AgentFacts）ベースで、プラットフォームロックインなし
- 🔌 **Claude Code MCPプラグイン** — コーディング中にClaude Codeがベンダーのエージェントに直接問い合わせ可能
- 📚 **プロジェクトレベルの知識永続化** — `.claude/peers/`はgitで管理され、セッション・開発者・デバイスをまたいで保持
- 🔐 **三層権限モデル** — Claude CodeのL1/L2/L3設計に着想を得た、安全で制御可能な権限管理
- 🌍 **多言語対応** — エージェント間のクロスランゲージ対話、引用は原文のまま保持
- 🏢 **フェデレーション** — セルフホストインスタンスとパブリッククラウドが相互接続

## クイックスタート

### 1. 自分で動かす（コマンド1つ）

必要なのは Docker だけ。このコマンドが gateway + Web クライアントをビルドし、
マイグレーションを実行し、すべてのサービスを起動します：

```bash
git clone https://github.com/hyhmrright/Confer.git
cd Confer
cp .env.example .env          # ローカルはデフォルトで動作。外部公開前にシークレットを変更すること
docker compose -f docker-compose.prod.yml up -d --build
```

**http://localhost** を開き、**注册 / Register** をクリックして最初のアカウントを作成、
**設定**で LLM API キーを登録します（キーはユーザーごとに暗号化して保存されます）。

詳しい手順・設定・トラブルシューティングは **[`docs/09-deployment.md`](../09-deployment.md)** を参照。

### 2. Claude Code からピア Agent に問い合わせる（プラグイン）

稼働中の gateway（上で起動したもの、またはアカウントを持つ任意の Confer インスタンス）に対して
`confer-a2a` プラグインをインストールします：

```
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer
```

Claude Code を起動する前に、シェルで認証情報を設定します（署名鍵は常に gateway に留まり、
プラグインは bearer token のみを持ちます）：

```bash
export CONFER_USERNAME=ユーザー名
export CONFER_PASSWORD=パスワード
# 上記のワンコマンド構成は nginx がポート 80 で配信するため、プラグインはここを指す：
export CONFER_GATEWAY_URL=http://localhost
# （下記 3 の dev モードでは gateway が直接 :3000 で動作し、それがデフォルト値）
```

あとは Claude Code で話すだけ — Confer アカウントの連絡先に問い合わせ、検証済みの事実を
プロジェクトメモリに書き込みます：

```
> X100のModbus温度読み取りコードを書いて
```

プラグインの詳細と公開される 9 つのツールは [`plugins/confer-a2a/README.md`](../../plugins/confer-a2a/README.md) を参照。

### 3. Confer 自体をローカル開発する

infra を Docker で動かし、gateway + クライアントをホットリロードで：

```bash
bun install
docker compose up -d            # infra のみ：Postgres、Redis、NATS、Qdrant、MinIO
bun run db:migrate
bun run dev
```

- **Webプレビュー**：ブラウザで http://localhost:1420 を開く
- **ネイティブデスクトップアプリ**：`cd packages/client && bunx tauri dev`

コントリビューション、monorepo 構成、テストスタックは **[`CONTRIBUTING.md`](../../CONTRIBUTING.md)** を参照。

## アーキテクチャ概要

```
[Clients] (Tauri 2.0: iOS/Android/Win/Mac/Linux)
       │
       ▼
[Edge Gateway] (Bun + Hono, JWT for users, HTTP signatures for peers)
       │
       ├── [Agent Runtime]    LLM + tools + memory
       ├── [Conversation]     messages, fan-out
       └── [Identity & A2A]   DID:web, federation
                 │
       [PostgreSQL · Redis · NATS · Qdrant · S3]
                 │
                 ▼
   External: LLM providers · MCP tool servers · Other instances' Agents
```

詳細は`docs/02-architecture.md`を参照。

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| [`CLAUDE.md`](../../CLAUDE.md) | Claude Code向け：プロジェクト規約とエントリポイント |
| [`docs/01-product.md`](../01-product.md) | 製品定義、ターゲットユーザー、主要シナリオ |
| [`docs/02-architecture.md`](../02-architecture.md) | システムアーキテクチャ |
| [`docs/03-protocol.md`](../03-protocol.md) | A2A、DID:web、AgentFacts、権限プロトコル |
| [`docs/04-data-model.md`](../04-data-model.md) | データベーススキーマ、TypeScript型定義 |
| [`docs/05-api.md`](../05-api.md) | REST + WS + A2Aインターフェース |
| [`docs/06-claude-code-plugin.md`](../06-claude-code-plugin.md) | MCPプラグイン設計 |
| [`docs/07-project-memory.md`](../07-project-memory.md) | `.claude/peers/`フォーマット |
| [`docs/08-mvp-backlog.md`](../08-mvp-backlog.md) | ロードマップ、タスクチェックリスト |
| [`docs/09-deployment.md`](../09-deployment.md) | セルフホスト、設定、トラブルシューティング |
| [`CONTRIBUTING.md`](../../CONTRIBUTING.md) | 開発環境、monorepo 構成、テストスタック |

## 技術スタック

- **バックエンド**: Bun + TypeScript + Hono
- **クライアント**: Tauri 2.0 + React 18 + TypeScript + Tailwind
- **データ**: PostgreSQL 16 + Redis + NATS + Qdrant + MinIO
- **プロトコル**: W3C DID, HTTP Message Signatures (RFC 9421), MCP, A2A (Google), AgentFacts (NANDA)
- **LLM**: BYOキー対応 (Claude / GPT / DeepSeek / Qwen / Ollama)

## ステータス

🚧 **v0.1.0リリース済み** — A2A 問い合わせフロー、RFC 9421 HTTP 署名、DID:web ID、RAG ナレッジベース、`confer-a2a` Claude Code プラグインが稼働中。残りの MVP 作業は `docs/08-mvp-backlog.md` を参照。

## ライセンス

未定（Apache 2.0またはAGPL-3.0を検討中。ビジネス戦略に応じて決定予定）。
