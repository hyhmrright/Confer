# Confer — デプロイとセルフホスティング

Confer の完全なインスタンスを自分で動かす方法 — 試しに手元のノート PC で、あるいは他者と共有するためにサーバー上で。ここに書かれていることはすべて実際に検証済みの手順であり、構想段階のものは一切ありません。

> **対象範囲:** このガイドは**シングルインスタンスのセルフホスト**構成を扱います。パブリックなマルチテナントホスティング、TLS 終端、フェデレーションのハードニングは v0.1 の対象外です — アーキテクチャの方向性については `docs/02-architecture.md` を参照してください。

## 得られるもの

1 つのコマンドでプラットフォーム全体がビルドされ起動します:

| サービス | イメージ / ビルド | 役割 |
|---------|---------------|------|
| `client` | `infra/client.Dockerfile` からビルド | Web UI + nginx リバースプロキシ（公開される唯一のポート） |
| `gateway` | `infra/gateway.Dockerfile` からビルド | Hono API、A2A エンドポイント、WebSocket |
| `migrate` | ワンショット | Drizzle マイグレーションを実行してから終了 |
| `postgres` | `postgres:16-alpine` | プライマリデータストア |
| `redis` | `redis:7-alpine` | セッション、レート制限、キャッシュ |
| `nats` | `nats:2-alpine` | メッセージバス / ファンアウト |
| `qdrant` | `qdrant/qdrant:v1.12.0` | RAG ナレッジベース向けのベクトル検索 |
| `minio` | `minio/minio` | S3 互換のファイルストレージ |

nginx（`client` 内）はポート **80** で SPA を配信し、`/api`、`/ws`、`/a2a`、`/.well-known` を gateway にリバースプロキシします。gateway 自身のポート（3000）は本番環境では**公開されません** — すべてはポート 80 の nginx を経由します。

## 前提条件

- Compose v2（`docker-compose` ではなく `docker compose`）を備えた **Docker**。これがワンコマンド手順の唯一の必須要件です。
- イメージ + ボリューム用に概ね 4 GB の空き RAM と 2 GB のディスク。
- [Bun](https://bun.sh) ≥ 1.1 — ホットリロードの開発ワークフロー（後述のオプション B）を使いたい場合、またはマイグレーションを再生成したい場合のみ。

## A. ワンコマンドでのセルフホスト（推奨）

```bash
git clone https://github.com/hyhmrright/Confer.git
cd Confer
cp .env.example .env
docker compose -f docker-compose.prod.yml up -d --build
```

初回のビルドには数分かかります。完了したら:

1. **http://localhost** を開きます。
2. **登録 / Register** をクリックして最初のアカウントを作成します。（登録は IP ごとに 1 時間あたり 3 回までにレート制限されています。）
3. **Settings** に移動して LLM API キー（Claude / OpenAI / DeepSeek / Qwen / Ollama）を追加します。キーは `ENCRYPTION_KEY`（AES-256-GCM）で保存時に暗号化され、クライアントに送信されることはありません。

これで完了です — 動作する Agent が手に入りました。Web UI で会話し、連絡先を追加し、ピア Agent に相談できます。

### 正常性を確認する

```bash
docker compose -f docker-compose.prod.yml ps        # all services "running"/"healthy"; migrate is "exited (0)"
docker compose -f docker-compose.prod.yml logs -f gateway
```

### 設定

`.env` が本番スタックを駆動します。`.env.example` のデフォルト値はローカル利用には機能しますが**安全ではありません** — インスタンスを他者に公開する前にシークレットを変更してください。

| 変数 | デフォルト（`.env.example`） | 備考 |
|----------|--------------------------|-------|
| `JWT_SECRET` | `change-me-in-production` | **これを変更してください。** ユーザーのセッショントークンに署名します。 |
| `ENCRYPTION_KEY` | 64 個のゼロ | **これを変更してください。** 32 バイトを 64 桁の 16 進文字で表す必要があります。生成方法: `openssl rand -hex 32`。保存される LLM キーを暗号化します。 |
| `POSTGRES_PASSWORD` | `confer`（compose のデフォルト） | データベースのパスワード。 |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | `confer` / `confer-secret` | オブジェクトストレージの認証情報。 |
| `EXPOSE_PORT` | `80` | Web UI がバインドするホストポート。80 が使用中の場合は例えば `8080` を設定します。 |
| `TAVILY_API_KEY` | 空 | Web 検索用の任意のフォールバック。Settings 内のユーザーごとのキーが優先されます。 |
| `ADMIN_USERNAMES` | 空 | gateway 起動時に `admin` ロールへ自動昇格させるユーザー名のカンマ区切りリスト。対象アカウントはあらかじめ登録済みである必要があります。管理者は通常のアカウントパスワードでログインして管理パネルを取得でき、その後 UI から他のユーザーを昇格できます。 |

> LLM / embedding / Tavily キーは `.env` に**設定しません** — これらはユーザーごとに暗号化されてデータベース内に存在し、Settings UI を通じて設定されます。`.env` のキーはインフラのシークレットのみです。

`.env` を編集した後は、次のコマンドで適用します:

```bash
docker compose -f docker-compose.prod.yml up -d
```

### 更新

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build   # migrate re-runs automatically
```

### リセット（すべてのデータを消去）

```bash
docker compose -f docker-compose.prod.yml down -v          # -v also deletes the volumes
```

## B. ローカル開発（ホットリロード）

インフラのみを Docker で動かし、アプリのコードは Bun で実行します:

```bash
bun install
docker compose up -d            # infra only — Postgres, Redis, NATS, Qdrant, MinIO (ports published on localhost)
bun run db:migrate
bun run dev                      # gateway on :3000, client (Vite) on :1420
```

- Web プレビュー: **http://localhost:1420**（Vite が `/api` → :3000 の gateway にプロキシします）。
- ネイティブデスクトップアプリ: `cd packages/client && bunx tauri dev`。

開発用の `docker-compose.yml` は各インフラのポートを localhost（5432、6379、4222、6333、9000/9001）に公開するため、ローカルで実行された gateway がそれらに到達できます。開発者向けワークフロー全体と分離されたテストスタックについては `CONTRIBUTING.md` を参照してください。

## Claude Code プラグインの接続

`confer-a2a` プラグインは HTTP 経由で gateway と通信します。**自分の構成に合った正しい URL を指定してください:**

| あなたの構成 | `CONFER_GATEWAY_URL` |
|------------|----------------------|
| ワンコマンドのセルフホスト（オプション A） | `http://localhost`（ポート 80 の nginx。gateway の 3000 は公開されていません） |
| ローカル開発（オプション B） | `http://localhost:3000`（デフォルト） |
| リモートインスタンス | `https://your-host` |

```bash
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer
```

```bash
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
export CONFER_GATEWAY_URL=http://localhost   # match the table above
```

相談するピア Agent は、あらかじめ自分のアカウントの**連絡先**でなければなりません（連絡先の追加が同意のゲートです）。プラグインの完全なリファレンス: [`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md)。

## インスタンスを他者に公開する

ワンコマンドのスタックはシングルテナントで、プレーンな HTTP でリッスンします。パブリックインターネット上に置く前に:

- TLS 終端を行うリバースプロキシ（Caddy、Traefik、または証明書を備えた nginx）の背後に配置してください。A2A の署名検証と DID:web はどちらも実世界では HTTPS を前提とします。
- DID ドキュメントと AgentFacts が正しいアドレスを広告するよう、`PUBLIC_HOST`（`.env` 内）を外部から到達可能なホストに設定してください。
- すべてのデフォルトシークレット（`JWT_SECRET`、`ENCRYPTION_KEY`、DB と MinIO のパスワード）を変更してください。
- 登録はデフォルトで開放されています。管理者は **Admin → Config** タブ（`registration_open`）からいつでも閉じることができ、招待制 / 許可リストで前面を覆うこともできます。

### Oracle Cloud（Always Free）での無料パブリックインスタンス

常時稼働のパブリックなテストインスタンスを最も安価に動かす方法は、Oracle Cloud の **Always Free** ARM ティア（4 OCPU / 24 GB / 10 TB エグレス、期間制限なし）です。スタック全体が `arm64` 上でビルドおよび実行されます。

1. VM を作成します: シェイプ **VM.Standard.A1.Flex**（最大 4 OCPU / 24 GB）、イメージ **Ubuntu 22.04+ (arm64)**。ARM のキャパシティは人気リージョンでは逼迫しています — 大きなリージョン（Ashburn、London）を選び、「out of capacity」に遭遇したら再試行してください。
2. Console で VCN の**セキュリティリスト / NSG** を開き、インバウンドの **TCP 80** を許可します（TLS を追加する場合は後で 443 も）。
3. SSH で接続してブートストラップを実行します（Docker のインストール、ホストファイアウォールの開放、クローン、シークレットの生成、スタックのビルドと起動を行います）:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh | bash
   ```

   あるいは先にクローンして `bash infra/oracle-bootstrap.sh` を実行します。冪等です。
4. `http://<vm-ip>/` を開いて登録し、その後自分に管理者権限を付与します: `~/Confer/.env` に `ADMIN_USERNAMES=<you>` を設定して `docker compose -f docker-compose.prod.yml up -d gateway` を実行します。

これは IP 経由のプレーンな HTTP で配信されます — テストには十分です。安定した `did:web` アイデンティティとフェデレーションのためには、ドメインを IP に向け、`PUBLIC_HOST` を設定し、TLS を追加してください（上記参照）。

## トラブルシューティング

| 症状 | 考えられる原因 / 対処 |
|---------|--------------------|
| ポート 80 で `port is already allocated` | 何か別のものがポート 80 を占有しています。`.env` に `EXPOSE_PORT=8080` を設定し、http://localhost:8080 を開きます。 |
| Web UI は読み込まれるがすべてのリクエストが 500 になる | `docker compose -f docker-compose.prod.yml logs gateway` を確認します。最も多いのは `JWT_SECRET` または `ENCRYPTION_KEY` が空のケースです — これらには compose のデフォルトがないため、`.env` に存在している必要があります。 |
| `migrate` が非ゼロで終了する | Postgres がまだ healthy でなかったか、`DATABASE_URL` が誤っています。`docker compose -f docker-compose.prod.yml up -d` を再実行してください。`migrate` は冪等です。 |
| プラグイン: `login failed` / 401 | `CONFER_GATEWAY_URL` が誤っている（表を参照 — 本番はポート 80 で 3000 ではありません）、もしくはユーザー名 / パスワードが誤っています。 |
| プラグイン: :3000 で `connection refused` | ワンコマンド構成を使っています。`:3000` の代わりに `http://localhost` を使ってください。 |
| LLM 呼び出しが失敗する | 自分のユーザーに LLM キーが設定されていません。Settings で追加してください。 |
| embedding / RAG エラー | Qdrant / embedding / MinIO の診断については `.claude/skills/rag-debug` を参照するか rag-debug スキルを実行してください。 |

## 関連項目

- [`docs/02-architecture.md`](./02-architecture.md) — システムアーキテクチャとサービス境界
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — 開発者セットアップ、テストスタック、規約
- [`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md) — Claude Code プラグインリファレンス
