# Confer — デプロイとセルフホスト

Confer のインスタンス一式を自分で動かす方法 — 試すためのノート PC でも、他の人と共有するためのサーバーでもよい。ここに書かれているのはすべて実際に通した経路であり、願望はひとつも含まれていない。

> **対象範囲:** 本書が扱うのは **単一インスタンスのセルフホスト**構成で、TLS の有無は問わない（後述の[HTTPS で配信する](#https-で配信する)を参照）。パブリックなマルチテナント運用とフェデレーションの堅牢化は v0.1 の範囲外である — アーキテクチャ上の方向性は `docs/02-architecture.md` を参照。

## 得られるもの

1 つのコマンドでプラットフォーム全体が起動する:

| サービス | イメージ / ビルド | 役割 |
|---------|---------------|------|
| `client` | ビルド元: `infra/client.Dockerfile` | Web UI + nginx リバースプロキシ（公開される唯一のポート） |
| `gateway` | ビルド元: `infra/gateway.Dockerfile` | Hono の API、A2A エンドポイント、WebSocket — **レプリカは 1 つだけ。下記参照** |
| `migrate` | ワンショット | Drizzle のマイグレーションを実行して終了する |
| `postgres` | `postgres:18-alpine` | 主データストア |
| `qdrant` | `qdrant/qdrant:v1.19.0` | RAG ナレッジベースのためのベクトル検索 |
| `minio` | `minio/minio` | S3 互換のファイルストレージ |

> **`gateway` をレプリカ 2 つ以上にスケールしてはいけない。** WebSocket の接続テーブル、A2A のリプレイ防止 nonce、レート制限のカウンタは、いずれもそのプロセスのメモリ上にある。2 つ目のレプリカはリプレイされた A2A リクエストを受け入れてしまい（そちらの nonce テーブルは空だから）、もう一方のレプリカにつながっているユーザーへの WS 配信を取りこぼし、レート制限のしきい値をレプリカ数だけ倍増させる。何から先に移すべきかは `docs/02-architecture.md` にある。

nginx は（`client` の中で）SPA をポート **80** で配信し、`/api`、`/ws`、`/a2a`、`/.well-known` を gateway へリバースプロキシする。gateway 自身のポート（3000）は本番では**公開しない** — すべてポート 80 の nginx を通る。

## 前提条件

- **Docker**（Compose v2、つまり `docker-compose` ではなく `docker compose`）。必須要件はこれだけ。
- **Node 18+** — `npx confer-cli`（選択肢 A）にのみ必要。同じ A にある素の Compose 経路なら不要。
- イメージとボリューム用に空きメモリ 4 GB 程度、ディスク 2 GB 程度。
- [Bun](https://bun.sh) ≥ 1.1 — ホットリロードの開発フロー（下記の選択肢 C）を使う場合か、マイグレーションを再生成する場合にのみ必要。

## A. 公開イメージ（推奨）

クローンするものも、ビルドするものもない:

```bash
npx confer-cli
```

[`confer-cli`](https://www.npmjs.com/package/confer-cli) は Docker が実際に動いていなければ起動を拒否する。`~/.confer` に `docker-compose.ghcr.yml` と `0600` の `.env` を書き（`JWT_SECRET`、`ENCRYPTION_KEY`、データベースとオブジェクトストアのパスワードはすべて初回に `crypto.randomBytes` で生成し、以後は再利用する）、イメージを取得し、マイグレーションを適用し、最大 3 分間 `/health` をポーリングする。成功を告げるのはページが配信されたときであって、コンテナが起動したときではない。そこまで至らなければ `migrate` と `gateway` のログの末尾 40 行を出力する。`npx confer-cli down` はデータを残したまますべて停止し、`npx confer-cli logs` は gateway を追尾する。

フラグ: `--port`（既定 80）、`--dir`（既定 `~/.confer`）、`--version`（イメージタグ）、`--project`（compose のプロジェクト名）。`confer` という名の compose プロジェクトがすでに存在し、しかもこの CLI が作ったものでない場合、CLI はそれを引き継がずに停止する — compose のボリュームはプロジェクト名で紐づくので、起動すればこれらのイメージがそのスタックのデータベースを指してしまう。

Node のないホスト向けに、同じことを手で:

```bash
curl -O https://raw.githubusercontent.com/hyhmrright/Confer/main/docker-compose.ghcr.yml
printf 'JWT_SECRET=%s\nENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env
docker compose -f docker-compose.ghcr.yml up -d
```

この場合 `POSTGRES_PASSWORD` と `MINIO_ROOT_PASSWORD` は compose ファイルの既定値（`confer` / `confer-secret`）のままになる。CLI ならランダム化していたところだ。どちらのポートも公開されないので単一テナントのマシンでは穴にはならないが、他人と共有するホストでは両方 `.env` に設定すること。

`ghcr.io/hyhmrright/confer-gateway` と `-client` は `main` への push ごとに linux/amd64 と linux/arm64 向けにビルドされ、`latest`、コミット SHA、リリースバージョンのタグが付く。固定したい場合は `.env` の `CONFER_VERSION` で。

`docker-compose.prod.yml` と違い、このファイルは `migrate` と `gateway` を*同じ*イメージから動かす。それが安全なのはここでは何もビルドしないからにすぎない — 両者が食い違いうる箇所については選択肢 B の警告を参照。

あとは **http://localhost** を開き、最初のアカウントを登録し、**設定**で LLM の API キーを追加する — 下の B に挙げた 3 ステップと同じである。

ここから先で `-f docker-compose.prod.yml` と書かれているものは、そのファイルのある場所（CLI が置いたなら `~/.confer`）から実行する限り `-f docker-compose.ghcr.yml` でも同様に通用する。ただし更新だけは別で、ビルドし直すものが何もないため、更新とは `npx confer-cli` を再実行するか `docker compose -f docker-compose.ghcr.yml pull && … up -d` することである。

## B. クローンからビルドする

改変したツリーを動かす場合や、GHCR に依存せずセルフホストしたい場合はこちら:

```bash
git clone https://github.com/hyhmrright/Confer.git
cd Confer
cp .env.example .env
docker compose -f docker-compose.prod.yml up -d --build
```

初回ビルドには数分かかる。終わったら:

1. **http://localhost** を開く。
2. **登録**をクリックし（ラベルは利用者自身の言語で表示される）、最初のアカウントを作る。（登録は IP ごとに 1 時間 3 回までに制限されている。）
3. **設定**へ行き、LLM の API キーを追加する（Claude / OpenAI / DeepSeek / Qwen / Ollama）。キーは `ENCRYPTION_KEY` により保存時に暗号化され（AES-256-GCM）、クライアントへ送られることは決してない。

### 正常性を確認する

```bash
docker compose -f docker-compose.prod.yml ps        # 全サービスが "running"/"healthy"、migrate は "exited (0)"
docker compose -f docker-compose.prod.yml logs -f gateway
```

### 設定

本番スタックを動かすのは `.env` である。`.env.example` の既定値はローカル用途では機能するが**安全ではない** — 自分以外の誰かにインスタンスを開く前に、シークレットを変更すること。

| 変数 | 既定値（`.env.example`） | 備考 |
|----------|--------------------------|-------|
| `JWT_SECRET` | `change-me-in-production` | **変更すること。** ユーザーのセッショントークンに署名する。 |
| `ENCRYPTION_KEY` | ゼロ 64 個 | **変更すること。** 32 バイト、すなわち 64 桁の 16 進文字でなければならない。生成: `openssl rand -hex 32`。保存された LLM キーを暗号化する。 |
| `POSTGRES_PASSWORD` | `confer` （compose の既定値） | データベースのパスワード。 |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | `confer` / `confer-secret` | オブジェクトストレージの資格情報。 |
| `EXPOSE_PORT` | `80` | Web UI がバインドするホスト側ポート。80 が使われているなら `8080` などにする。 |
| `TAVILY_API_KEY` | 空 | Web 検索の任意のフォールバック。設定画面のユーザーごとのキーが優先される。 |
| `ADMIN_USERNAMES` | 空 | カンマ区切りのユーザー名。gateway 起動時に自動で `admin` ロールへ昇格する。アカウントは事前に登録済みでなければならない。管理者は通常のアカウントのパスワードでログインして管理パネルを得る。以後は UI から他の人を昇格できる。 |

> LLM / embedding / Tavily のキーは `.env` に**置かない** — それらはユーザーごとに暗号化されてデータベースにあり、設定 UI から構成する。`.env` にあるキーはインフラのシークレットだけである。

`.env` を編集したら、次で反映する:

```bash
docker compose -f docker-compose.prod.yml up -d
```

### 更新

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build   # migrate は自動で再実行される
```

### リセット（すべてのデータを消去）

```bash
docker compose -f docker-compose.prod.yml down -v          # -v はボリュームも削除する
```

## C. ローカル開発（ホットリロード）

Docker ではインフラだけを動かし、アプリのコードは Bun で動かす:

```bash
bun install
docker compose up -d            # インフラのみ — Postgres、Qdrant、MinIO（ポートは localhost に公開）
bun run db:migrate
bun run dev                      # gateway は :3000、クライアント（Vite）は :1420
```

- Web プレビュー: **http://localhost:1420**（Vite が `/api` を :3000 の gateway へプロキシする）。
- ネイティブのデスクトップアプリ: `cd packages/client && bunx tauri dev`。

開発用の `docker-compose.yml` は各インフラのポートを localhost に公開する（5432、6333、6334、9000/9001）ので、ローカルで動く gateway から到達できる。開発者向けワークフロー全体と分離されたテストスタックについては `CONTRIBUTING.md` を参照。

## Claude Code プラグインの接続

`confer-a2a` プラグインは gateway と HTTP で話す。**自分の構成に合った URL を指すこと:**

| あなたの構成 | `CONFER_GATEWAY_URL` |
|------------|----------------------|
| 公開イメージまたはクローン（選択肢 A/B） | `http://localhost` （nginx がポート 80。gateway の 3000 は公開されない） |
| ローカル開発（選択肢 C） | `http://localhost:3000` （既定値） |
| リモートのインスタンス | `https://your-host` |

```bash
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer
```

```bash
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
export CONFER_GATEWAY_URL=http://localhost   # 上の表に合わせる
```

相談する相手の Agent は、あらかじめ自分のアカウントの**連絡先**になっていなければならない（連絡先の追加が同意のゲートである）。プラグインの詳細: [`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md)。

## インスタンスを他者に公開する

既定のスタックは素の HTTP で待ち受ける。自分のユーザーには十分だが、フェデレーションにはまったく役に立たない。**ここでの HTTPS は堅牢化の一手ではなく、機能そのものである。** agent の身元は `did:web` であり、その解決アルゴリズムは https 専用だ。`did:web:あなたのドメイン:agents:あなた` を渡された相手は `https://あなたのドメイン/agents/あなた/did.json` を取りに行き、それ以外は取りに行かない。これを http で配信すれば、どの peer の署名検証も解決の段階で失敗する — 署名を見るところまで到達すらしない。

### HTTPS で配信する

`docker-compose.tls.yml` はスタックの前段に Caddy を置くオーバーレイで、Caddy が証明書の取得と更新を自分で行う。どちらのベースファイルにも重ねられる:

```bash
PUBLIC_HOST=confer.example.com \
  docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml up -d
```

あるいは CLI から `npx confer-cli --domain confer.example.com`。

3 つの条件が満たされている必要があり、満たされるまで Caddy は再試行を続ける（`docker compose … logs caddy` を見ること）:

- `PUBLIC_HOST` は**裸のドメイン**であること — スキームもポートも付けない。Caddy は 443 を提供し、オーバーレイのポートマッピングは固定なので、ここに `:8443` と書くと何も転送されない場所で待ち受けることになる。
- そのドメインの A/AAAA レコードがすでにこのホストを指していること。
- **80 と 443** の両方がインターネットから到達可能であること。80 は省略できない: Let's Encrypt は 443 で何かを配信できるようになる前に、80 経由で検証する。

オーバーレイは `client` コンテナから公開ポートを取り上げるので、`EXPOSE_PORT` はもう効かない。証明書は `caddydata` ボリュームにあり、これを失うと再発行になる（再発行にはレート制限がある）。

### その他すべて

- アカウントを作る前に `PUBLIC_HOST` を設定すること。このインスタンスが発行する DID はすべてそこから導出されるので、見た目の問題ではない。`localhost` のままだと、peer に渡した身元は*その peer 自身の*ループバックへ解決されてしまう。あとから変更した場合、古い `localhost` を抱えたままの身元は次回起動時に再ホストされる（一度きりで、ログに残る）。ただし古い DID をすでに持っている peer は、連絡先を追加し直す必要がある。
- 既定のシークレットをすべて変更すること（`JWT_SECRET`、`ENCRYPTION_KEY`、DB と MinIO のパスワード）。
- 登録は既定で開いている。管理者はいつでも **Admin → Config** タブ（`registration_open`）から閉じられるし、招待制や許可リストを前段に置いてもよい。

自前のリバースプロキシ（Traefik、既存の nginx、クラウドのロードバランサ）を持ち込んでもよい — オーバーレイは使わず、好きなところで TLS を終端し、`client` コンテナのポート 80 へ転送する。`PUBLIC_HOST` は証明書の名前と一致していなければならない点は変わらない。

### Oracle Cloud（Always Free）での無料パブリックインスタンス

常時稼働のパブリックなテストインスタンスを最も安く動かす方法は、Oracle Cloud の **Always Free** の ARM ティア（4 OCPU / 24 GB / 10 TB の下り、期限なし）である。スタック全体が `arm64` でビルドでき、動作する。

1. VM を作る: シェイプ **VM.Standard.A1.Flex**（最大 4 OCPU / 24 GB）、イメージ **Ubuntu 22.04+ (arm64)**。人気リージョンでは ARM の空きが逼迫している — 大きなリージョン（Ashburn、London）を選び、「out of capacity」が出たら再試行する。
2. コンソールで VCN の **security list / NSG** を開き、**TCP 80 と 443** の受信を許可する。ドメインなしで始める場合も両方を今のうちに開けること — スクリプトはホスト側のファイアウォールを両方について開けるが、こちら側には手が届かない。
3. SSH で入り、ブートストラップを実行する（Docker の導入、ホストのファイアウォール開放、クローン、シークレット生成、ビルドとスタック起動を行う）:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh | bash
   ```

   VM を指すドメインがすでにあるなら、同時に HTTPS も要求する:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh \
     | CONFER_DOMAIN=confer.example.com bash
   ```

   または先にクローンして `bash infra/oracle-bootstrap.sh` を実行する。冪等であり、`CONFER_DOMAIN` 付きで再実行すれば既存のインスタンスをそのドメインへ移せる。
4. 表示された URL を開いて登録し、次に自分へ管理者権限を与える: `~/Confer/.env` に `ADMIN_USERNAMES=<あなた>` を設定し、同じ `-f` ファイルで `up -d gateway` をやり直す。

`CONFER_DOMAIN` なしの場合は IP で素の HTTP を配信する — テストには十分だが、`did:web` は HTTPS でしか解決しないため、そのインスタンスはフェデレーションできない。

## 2026-08-29 より前に作られたインスタンスのアップグレード

Confer は現在 **PostgreSQL 18** と **Qdrant 1.19** で動く。以前は 16 と 1.12 だった。どちらも古い方が書いたストレージを読まないので、すでにデータを持つインスタンスは起動前に一度の移行が必要になる。失われるものはなく、どちらの失敗も派手に出る: postgres は起動を拒否して理由を述べ、qdrant は読み込み時に panic する。新規インストールにはこの作業は一切不要である。

`npx confer-cli` は何かを起動する前に postgres のケースを検査し、同じ手順を出力する。当面は旧バージョンに留まりたい場合、それを同梱していた CLI を実行すること: `npx confer-cli@0.3.3`。

以下は自分の compose ファイルとプロジェクト名に読み替えること — クローンなら `docker-compose.prod.yml`、CLI 経路なら `-p confer -f ~/.confer/docker-compose.ghcr.yml`。ボリューム名は `<プロジェクト>_pgdata` と `<プロジェクト>_qdrantdata` である。

**1. バックアップを 2 通り取る。** 論理ダンプと各ボリュームのバイトコピーは壊れ方が違う。両方取るのはまさにそのためである。

```bash
docker compose -f docker-compose.prod.yml exec -T postgres pg_dumpall -U confer > pg16-dumpall.sql
for v in pgdata qdrantdata; do
  docker volume create confer_${v}_backup
  docker run --rm -v confer_$v:/from -v confer_${v}_backup:/to alpine:3.24 sh -c 'cd /from && cp -a . /to/'
done
```

**2. ベクトルをエクスポートする** — ベクトルごと出すので、埋め込みをやり直す必要はない。出力は `qdrant-export.json` に保存する:

```bash
docker compose -f docker-compose.prod.yml exec -T gateway bun -e '
const base = "http://qdrant:6333", out = {};
for (const { name } of (await (await fetch(base + "/collections")).json()).result.collections) {
  const info = (await (await fetch(base + "/collections/" + name)).json()).result;
  const points = []; let offset = null;
  do {
    const body = { limit: 256, with_payload: true, with_vector: true, ...(offset ? { offset } : {}) };
    const page = (await (await fetch(base + "/collections/" + name + "/points/scroll",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()).result;
    points.push(...page.points); offset = page.next_page_offset;
  } while (offset);
  out[name] = { config: info.config.params, points };
}
console.log(JSON.stringify(out));' > qdrant-export.json
```

**3. ボリュームを差し替えて新バージョンを起動する。** 破壊的なのはボリュームの削除である。手順 1 と 2 が実際にファイルを生成し、それを自分の目で確かめるまでは実行しないこと。

```bash
docker compose -f docker-compose.prod.yml down
docker volume rm confer_pgdata confer_qdrantdata
docker compose -f docker-compose.prod.yml up -d postgres qdrant --wait
```

**4. リストアする。** ダンプは、新しいコンテナがすでに作成済みの `confer` ロールとデータベースを作り直そうとするので、`already exists` のエラーが 2 件出るのは想定どおりである。それ以外は想定外。

```bash
docker compose -f docker-compose.prod.yml exec -T postgres psql -U confer -d postgres < pg16-dumpall.sql
docker compose -f docker-compose.prod.yml up -d
```

続いてベクトルを戻す — アプリはコレクションを遅延生成するだけなので、コレクションを先に作ること:

```bash
docker compose -f docker-compose.prod.yml exec -T gateway bun -e '
const base = "http://qdrant:6333";
const data = JSON.parse(await new Response(Bun.stdin.stream()).text());
for (const [name, { config, points }] of Object.entries(data)) {
  await fetch(base + "/collections/" + name,
    { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(config) });
  if (points.length === 0) continue;
  await fetch(base + "/collections/" + name + "/points?wait=true",
    { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ points }) });
}' < qdrant-export.json
```

**5. ログではなくデータで検証する。** 行数は旧インスタンスのものと一致するはずで、検索は結果を返すはずである:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U confer -d confer -tAc "select count(*) from users;"
docker compose -f docker-compose.prod.yml exec -T gateway bun -e '
const j = await (await fetch("http://qdrant:6333/collections/knowledge_chunks")).json();
console.log(j.result.points_count);'
```

`confer_pgdata_backup` と `confer_qdrantdata_backup` は、インスタンスをしばらく使ってみるまで残しておくこと — 戻る道はそれしかない。

## トラブルシューティング

| 症状 | 考えられる原因 / 対処 |
|---------|--------------------|
| アップグレード後に `postgres` が再起動を繰り返す | そのボリュームは PostgreSQL 16 が書いたものである。[2026-08-29 より前に作られたインスタンスのアップグレード](#2026-08-29-より前に作られたインスタンスのアップグレード)を参照。 |
| `qdrant` が panic のバックトレースとともに 101 で終了する | そのストレージは Qdrant 1.12 が書いたものである。上と同じ節を参照。 |
| 80 で `port is already allocated` | ポート 80 は別のものが握っている。`.env` に `EXPOSE_PORT=8080` を設定し、http://localhost:8080 を開く。 |
| Web UI は読み込まれるが、あらゆるリクエストが 500 になる | `docker compose -f docker-compose.prod.yml logs gateway` を確認する。多くの場合 `JWT_SECRET` か `ENCRYPTION_KEY` が空である。これらには compose の既定値がないので、`.env` に存在しなければならない。 |
| `migrate` が 0 以外で終了する | Postgres がまだ healthy でなかったか、`DATABASE_URL` が誤っている。`docker compose -f docker-compose.prod.yml up -d` をやり直す。`migrate` は冪等である。 |
| プラグイン: `login failed` / 401 | `CONFER_GATEWAY_URL` が誤っている（表を参照 — 本番はポート 80 であって 3000 ではない）か、ユーザー名かパスワードが誤っている。 |
| :3000 でプラグインが `connection refused` | ワンコマンド構成を使っているのだから、`:3000` ではなく `http://localhost` を使う。 |
| LLM の呼び出しが失敗する | そのユーザーに LLM キーが設定されていない。設定画面で追加する。 |
| Embedding / RAG のエラー | `.claude/skills/rag-debug` を参照するか、rag-debug スキルを実行して Qdrant / embedding / MinIO を診断する。 |

## 関連項目

- [`docs/02-architecture.md`](./02-architecture.md) — システムアーキテクチャとサービス境界
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — 開発環境のセットアップ、テストスタック、規約
- [`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md) — Claude Code プラグインのリファレンス
