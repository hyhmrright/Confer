# Confer

> あなたのAIが、誰とでも会議する。

🌐 **Language / 语言 / 言語**: [English](./README.md) | [简体中文](./README.zh-CN.md) | [日本語](./README.ja.md)

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

### ユーザー視点（Claude Codeプラグインのインストール）

```bash
claude mcp add confer npx -y @confer/mcp-server
# 初回使用時にClaude CodeがOAuth認証を自動案内します
```

あとはClaude Codeで話すだけ：

```
> X100のModbus温度読み取りコードを書いて
```

Claude Codeは登録済みのABC工業エージェントに自動問い合わせし、検証済みの事実をプロジェクトメモリに書き込みます。

### 開発者視点（ローカル開発）

```bash
git clone https://github.com/hyhmrright/Confer.git
cd confer
bun install
docker compose -f infra/docker-compose.yml up -d
bun run db:migrate
bun run dev
```

http://localhost:1420 を開く。

### セルフホスト企業インスタンス

```bash
docker compose -f infra/docker-compose.prod.yml up -d
```

詳細は`docs/02-architecture.md`の「デプロイアーキテクチャ」セクションを参照。

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
| [`CLAUDE.md`](./CLAUDE.md) | Claude Code向け：プロジェクト規約とエントリポイント |
| [`docs/01-product.md`](./docs/01-product.md) | 製品定義、ターゲットユーザー、主要シナリオ |
| [`docs/02-architecture.md`](./docs/02-architecture.md) | システムアーキテクチャ |
| [`docs/03-protocol.md`](./docs/03-protocol.md) | A2A、DID:web、AgentFacts、権限プロトコル |
| [`docs/04-data-model.md`](./docs/04-data-model.md) | データベーススキーマ、TypeScript型定義 |
| [`docs/05-api.md`](./docs/05-api.md) | REST + WS + A2Aインターフェース |
| [`docs/06-claude-code-plugin.md`](./docs/06-claude-code-plugin.md) | MCPプラグイン設計 |
| [`docs/07-project-memory.md`](./docs/07-project-memory.md) | `.claude/peers/`フォーマット |
| [`docs/08-mvp-backlog.md`](./docs/08-mvp-backlog.md) | ロードマップ、タスクチェックリスト |

## 技術スタック

- **バックエンド**: Bun + TypeScript + Hono
- **クライアント**: Tauri 2.0 + React 18 + TypeScript + Tailwind
- **データ**: PostgreSQL 16 + Redis + NATS + Qdrant + MinIO
- **プロトコル**: W3C DID, HTTP Message Signatures (RFC 9421), MCP, A2A (Google), AgentFacts (NANDA)
- **LLM**: BYOキー対応 (Claude / GPT / DeepSeek / Qwen / Ollama)

## ステータス

🚧 **v0.0.1リリース済み** — 初期プラットフォームの骨格（デスクトップ・モバイルビルド対応）。コアA2A機能は`docs/08-mvp-backlog.md`のロードマップに沿って開発中。

## ライセンス

未定（Apache 2.0またはAGPL-3.0を検討中。ビジネス戦略に応じて決定予定）。
