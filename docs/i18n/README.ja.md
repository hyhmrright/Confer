<div align="center">

<img src="../assets/social/og.png" alt="Confer — あなたの AI が、誰の AI とも話せる" width="840">

**[ウェブサイト](https://hyhmrright.github.io/Confer/)** · **[ドキュメント](../)** · **[Claude Code プラグイン](../../plugins/confer-a2a/README.md)** · **[リリース](https://github.com/hyhmrright/Confer/releases)**

[![Release](https://img.shields.io/github/v/release/hyhmrright/Confer?style=flat-square&color=e6a23c)](https://github.com/hyhmrright/Confer/releases)
[![License](https://img.shields.io/github/license/hyhmrright/Confer?style=flat-square&color=e6a23c)](../../LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/hyhmrright/Confer/ci.yml?branch=main&style=flat-square)](https://github.com/hyhmrright/Confer/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square)](../../tsconfig.json)

[English](../../README.md) · [简体中文](./README.zh-CN.md) · 日本語

</div>

---

## Confer とは

> **あなたの AI が、誰の AI とも話せる。**

あなたのコーディングエージェントは、社内システムもチームの規約も、いま統合しようとしている
サードパーティ SDK の癖も知りません。だから推測で書き、あなたは一日中ドキュメントを
チャット欄に貼り付けることになります。

**Confer は、その知識にアドレスを与えます。** 自分の Agent を立ち上げ、そこにドキュメント、
ナレッジベース、ルールを持たせる。Claude Code は MCP 経由でその Agent に問い合わせ、
**出典付きの回答**を受け取り、検証済みの事実を `.claude/peers/` に書き込みます。
ファイルは git と共に移動し、次回から自動で再利用されます。

同じ経路は組織をまたいでも機能します。相手側も Agent を運用していれば——ベンダー、
パートナー、他チーム——2 つの Agent が署名付き・ID 検証済みのプロトコルで直接対話します。
どちらの人間も、相手のドキュメントを読む必要がありません。

<img src="../assets/social/how-it-works.png" alt="Confer の仕組み：Claude Code が MCP 経由で自分の Confer インスタンスに問い合わせ、インスタンスが署名付き A2A で相手の Agent に照会し、出典付きの回答が .claude/peers/ に蓄積される" width="100%">

## 注目に値する理由

- **ノード 1 つでも役に立つ。** 自分のドキュメントに向けるだけで、コーディングエージェントは
  推測をやめます。誰かが先に参加するのを待つ必要はありません。
- **回答には出典が付く。** すべての事実は元のドキュメントまで遡れ、原文の言語が保持されます。
- **知識はセッションを越えて残る。** `.claude/peers/{peer}/facts.md` はプレーンな Markdown で、
  リポジトリにコミットされます——コンテキストウィンドウ、マシン、チームメイトを越えて残ります。
- **中間にプラットフォームがない。** A2A、W3C DID:web、HTTP メッセージ署名（RFC 9421）、
  NANDA AgentFacts、MCP といったオープンプロトコル上に構築。セルフホストし、誰とでも
  フェデレーションできます。
- **鍵はあなたのもの。** LLM と embedding のキーはユーザーごとに AES-256-GCM で暗号化され、
  gateway の外には出ません。
- **同意は形式ではなくゲート。** 相手はあなたが承認するまで到達できません。3 層の権限モデル
  （L1/L2/L3）が、無人時に Agent が何をしてよいかを決めます。

## クイックスタート

### 1 · 自分のインスタンスを起動する

必要なのは Docker だけ。clone もビルドも不要です。公開済みイメージを取得し、このインスタンス
専用のシークレットを生成し、マイグレーションを実行してすべてのサービスを起動します：

```bash
curl -O https://raw.githubusercontent.com/hyhmrright/Confer/main/docker-compose.ghcr.yml
printf 'JWT_SECRET=%s\nENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env
docker compose -f docker-compose.ghcr.yml up -d
```

**http://localhost** を開き、最初のアカウントを登録してから、**設定**で LLM API キーを
入力してください（ユーザーごとに暗号化して保存されます）。

この `.env` は必ず保管してください。インスタンスに保存された API キーは `ENCRYPTION_KEY`
で復号されるため、失うとキーも失われます。停止してデータを残すには
`docker compose -f docker-compose.ghcr.yml down` を実行します。

イメージは `main` への push ごとに linux/amd64 と linux/arm64 向けにビルドされます。
ソースからビルドする場合は [3 · Confer 自体を開発する](#3--confer-自体を開発する) を参照。

設定・リバースプロキシ・トラブルシュートは **[`docs/09-deployment.md`](../09-deployment.md)** を参照。

### 2 · Claude Code をつなぐ

いま起動したインスタンスに対して `confer-a2a` プラグインをインストールします：

```
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer
```

Claude Code を起動する**前に**、シェルで認証情報を設定します。署名鍵は gateway から出ず、
プラグインは bearer token のみを持ちます：

```bash
export CONFER_USERNAME=あなたのユーザー名
export CONFER_PASSWORD=パスワード
export CONFER_GATEWAY_URL=http://localhost   # 上記のスタックは nginx が 80 番で配信
```

あとは普段どおり作業するだけ。Claude Code が Confer アカウント内の連絡先に問い合わせ、
学んだ内容をプロジェクトメモリに書き込みます：

```
> X100 の Modbus 温度読み取りを書いて
```

プラグインと提供ツールは [`plugins/confer-a2a/README.md`](../../plugins/confer-a2a/README.md) を参照。

### 3 · Confer 自体を開発する

インフラは Docker、gateway とクライアントはホットリロードで：

```bash
bun install
docker compose up -d    # インフラのみ：Postgres、Redis、NATS、Qdrant、MinIO
bun run db:migrate
bun run dev
```

- **Web プレビュー**：http://localhost:1420
- **ネイティブデスクトップアプリ**：`cd packages/client && bunx tauri dev`

monorepo 構成、テストスタック、コーディング規約は **[`CONTRIBUTING.md`](../../CONTRIBUTING.md)** を参照。

## アーキテクチャ

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

詳細は [`docs/02-architecture.md`](../02-architecture.md)。

## 技術スタック

- **バックエンド**：Bun + TypeScript + Hono
- **クライアント**：Tauri 2.0 + React 19 + TypeScript + Tailwind
- **データ**：PostgreSQL 16 + Redis + NATS + Qdrant + MinIO
- **プロトコル**：W3C DID、HTTP メッセージ署名（RFC 9421）、MCP、A2A、NANDA AgentFacts
- **LLM**：BYOK（Claude · GPT · DeepSeek · Qwen · GLM · Ollama）

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| [`docs/01-product.md`](../01-product.md) | プロダクト定義、対象ユーザー、Hero scenarios |
| [`docs/02-architecture.md`](../02-architecture.md) | システムアーキテクチャ |
| [`docs/03-protocol.md`](../03-protocol.md) | A2A、DID:web、AgentFacts、権限プロトコル |
| [`docs/04-data-model.md`](../04-data-model.md) | DB スキーマ、TypeScript 型 |
| [`docs/05-api.md`](../05-api.md) | REST + WebSocket + A2A インターフェース |
| [`docs/06-claude-code-plugin.md`](../06-claude-code-plugin.md) | MCP プラグイン設計 |
| [`docs/07-project-memory.md`](../07-project-memory.md) | `.claude/peers/` フォーマット |
| [`docs/08-mvp-backlog.md`](../08-mvp-backlog.md) | ロードマップとタスク一覧 |
| [`docs/09-deployment.md`](../09-deployment.md) | セルフホスト、設定、トラブルシュート |
| [`CONTRIBUTING.md`](../../CONTRIBUTING.md) | 開発環境、monorepo 構成、テストスタック |
| [`SECURITY.md`](../../SECURITY.md) | セキュリティポリシーと運用時の推奨設定 |
| [`CLAUDE.md`](../../CLAUDE.md) | Claude Code 向け：プロジェクト規約とエントリポイント |

## ステータス

**v0.3.1 —— 動作します。1.0 前、セルフホストのみ。**

実装済み：A2A 相談フロー、RFC 9421 HTTP 署名、DID:web アイデンティティ、RAG ナレッジベース
（MinIO + Qdrant + マルチプロバイダ embedding）、Agent の長期記憶、3 層権限、管理コンソール、
3 言語 UI（EN/中文/日本語）、そして `confer-a2a` Claude Code プラグイン。すべての PR で、
実際の Postgres + Qdrant + MinIO スタックに対して全テストを実行しています。

まだないもの：公式ホスティングの公開インスタンスはありません——セルフホストが前提です。
デスクトップ／モバイルのビルドは各リリースで配布していますが、Web クライアントほど
検証されていません。残りのスコープは [`docs/08-mvp-backlog.md`](../08-mvp-backlog.md) を参照。

<img src="../assets/screenshot-login.png" alt="Confer Web クライアント" width="100%">

## コントリビューション

issue と PR を歓迎します——開発環境は [`CONTRIBUTING.md`](../../CONTRIBUTING.md)、
着手しやすいタスクは
[`good first issue`](https://github.com/hyhmrright/Confer/labels/good%20first%20issue)
にあります。質問やアイデアは
[Discussions](https://github.com/hyhmrright/Confer/discussions) へどうぞ。

セキュリティ上の問題：公開 issue ではなく [`SECURITY.md`](../../SECURITY.md) の手順に
従って非公開でご報告ください。

## ライセンス

[Apache License 2.0](../../LICENSE)。
