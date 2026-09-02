# Confer — 部署与自托管

如何自己跑起一套完整的 Confer 实例——在笔记本上试用,或放在服务器上供他人使用。
本文写的每一条路径都真实跑通过,没有一条是设想中的。

> **适用范围:**本指南覆盖**单实例自托管**部署,带或不带 TLS(见
> [用 HTTPS 提供服务](#用-https-提供服务))。面向公众的多租户托管和联邦加固不在 v0.1
> 范围内——架构方向见 `docs/02-architecture.md`。

## 你会得到什么

一条命令启动整个平台:

| 服务 | 镜像 / 构建 | 职责 |
|---------|---------------|------|
| `client` | 由 `infra/client.Dockerfile` 构建 | Web UI + nginx 反向代理(唯一对外暴露的端口) |
| `gateway` | 由 `infra/gateway.Dockerfile` 构建 | Hono API、A2A 端点、WebSocket——**单副本,原因见下** |
| `migrate` | 一次性任务 | 执行 Drizzle 迁移后退出 |
| `postgres` | `postgres:18-alpine` | 主数据存储 |
| `qdrant` | `qdrant/qdrant:v1.19.0` | RAG 知识库的向量检索 |
| `minio` | `minio/minio` | S3 兼容的文件存储 |

> **不要把 `gateway` 扩到一个副本以上。**WebSocket 连接、A2A 重放 nonce 和限流计数
> 都存在那个进程的内存里。第二个副本会接受被重放的 A2A 请求(它的 nonce 表是空的)、
> 收不到连在另一个副本上的用户的 WS 推送,并且把限流阈值乘以副本数。要先搬走哪些东西,
> 见 `docs/02-architecture.md`。

nginx(在 `client` 容器内)在 **80** 端口提供 SPA,并把 `/api`、`/ws`、`/a2a`、
`/.well-known` 反向代理到 gateway。生产环境**不**发布 gateway 自己的端口(3000)——
所有流量都走 80 端口上的 nginx。

## 前置条件

- **Docker**,带 Compose v2(`docker compose`,不是 `docker-compose`)。唯一的硬性要求。
- **Node 18+**——只有 `npx confer-cli`(方案 A)需要。同属方案 A 的纯 Compose 路径不需要它。
- 大约 4 GB 空闲内存,以及 2 GB 磁盘用于镜像和卷。
- [Bun](https://bun.sh) ≥ 1.1——只有当你要用热重载开发流程(下面的方案 C)
  或重新生成迁移文件时才需要。

## A. 使用已发布镜像(推荐)

不用克隆,也不用构建:

```bash
npx confer-cli
```

[`confer-cli`](https://www.npmjs.com/package/confer-cli) 在 Docker 没真正运行时会拒绝启动;
它把 `docker-compose.ghcr.yml` 和一个权限为 `0600` 的 `.env` 写进 `~/.confer`——
其中 `JWT_SECRET`、`ENCRYPTION_KEY` 以及数据库和对象存储的密码,都在首次运行时用
`crypto.randomBytes` 生成并在此后复用——然后拉取镜像、执行迁移,并轮询 `/health` 最多三分钟。
它是在页面真的能打开时才报告成功,而不是在容器启动时;如果一直没等到,它会打印
`migrate` 和 `gateway` 日志的最后 40 行。`npx confer-cli down` 停掉一切并保留数据,
`npx confer-cli logs` 跟踪 gateway 的日志。

参数:`--port`(默认 80)、`--dir`(默认 `~/.confer`)、`--version`(镜像标签)、
`--project`(compose 项目名)。如果已经存在一个名为 `confer` 的 compose 项目而它不是这个
CLI 创建的,CLI 会停下来而不是接管它——compose 的卷是按项目名索引的,直接启动会让这些镜像
指向那套栈的数据库。

在没有 Node 的主机上手工做同样的事:

```bash
curl -O https://raw.githubusercontent.com/hyhmrright/Confer/main/docker-compose.ghcr.yml
printf 'JWT_SECRET=%s\nENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env
docker compose -f docker-compose.ghcr.yml up -d
```

这样会让 `POSTGRES_PASSWORD` 和 `MINIO_ROOT_PASSWORD` 停留在 compose 文件的默认值
(`confer` / `confer-secret`),而 CLI 本来会把它们随机化。这两个端口都没有发布,
所以在单租户机器上不构成漏洞——但在任何与他人共用的主机上,都要在 `.env` 里把两者设好。

`ghcr.io/hyhmrright/confer-gateway` 和 `-client` 在每次推送到 `main` 时都会构建
linux/amd64 和 linux/arm64 两个架构,并打上 `latest`、提交 SHA 和发布版本号三种标签。
要固定某一个,在 `.env` 里设 `CONFER_VERSION`。

与 `docker-compose.prod.yml` 不同,这个文件用**同一个**镜像跑 `migrate` 和 `gateway`。
这只有在这里什么都不构建的前提下才安全——见方案 B 下面的警告,那里才是两者会漂移的地方。

然后打开 **http://localhost**,注册第一个账号,并在**设置**里添加一个 LLM API key——
就是下面方案 B 列出的同样三步。

从这里往后所有写着 `-f docker-compose.prod.yml` 的地方,换成 `-f docker-compose.ghcr.yml`
在那个文件所在目录(CLI 放的话就是 `~/.confer`)执行同样成立,只有更新是例外:这里没有东西
要重新构建,所以更新就是再跑一次 `npx confer-cli`,或者
`docker compose -f docker-compose.ghcr.yml pull && … up -d`。

## B. 从克隆构建

如果你要跑一棵改动过的代码树,或者不想依赖 GHCR 来自托管,用这个:

```bash
git clone https://github.com/hyhmrright/Confer.git
cd Confer
cp .env.example .env
docker compose -f docker-compose.prod.yml up -d --build
```

首次构建要几分钟。完成之后:

1. 打开 **http://localhost**。
2. 点击**注册**(按钮上显示的是你自己的语言)并创建第一个账号。
   (注册限流为每个 IP 每小时 3 次。)
3. 进入**设置**,添加一个 LLM API key(Claude / OpenAI / DeepSeek / Qwen /
   Ollama)。key 用 `ENCRYPTION_KEY` 加密存储(AES-256-GCM),永远不会下发到客户端。

到这里就完成了——你现在有一个能用的 Agent。在 Web UI 里和它对话、添加联系人,
并向对端 Agent 发起咨询。

### 确认它是健康的

```bash
docker compose -f docker-compose.prod.yml ps        # 所有服务应为 "running"/"healthy",migrate 应为 "exited (0)"
docker compose -f docker-compose.prod.yml logs -f gateway
```

### 配置

生产栈由 `.env` 驱动。`.env.example` 里的默认值本地可用,但**并不安全**——
在把实例开放给任何其他人之前,先把这些机密换掉。

| 变量 | 默认值(`.env.example`) | 说明 |
|----------|--------------------------|-------|
| `JWT_SECRET` | `change-me-in-production` | **必须改。**用于签发用户会话 token。 |
| `ENCRYPTION_KEY` | 64 个零 | **必须改。**必须是 32 字节、写成 64 个十六进制字符。生成方式:`openssl rand -hex 32`。用于加密存储的 LLM key。 |
| `POSTGRES_PASSWORD` | `confer`(compose 默认值) | 数据库密码。 |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | `confer` / `confer-secret` | 对象存储凭据。 |
| `EXPOSE_PORT` | `80` | Web UI 绑定的宿主机端口。80 被占用时可设成比如 `8080`。 |
| `TAVILY_API_KEY` | 空 | 网页搜索的可选兜底;设置里的用户级 key 优先。 |
| `ADMIN_USERNAMES` | 空 | 逗号分隔的用户名,在 gateway 启动时自动提升为 `admin` 角色。这些账号必须已经注册。管理员用自己账号的普通密码登录即可进入管理面板;之后可以在界面上提升其他人。 |

> LLM / embedding / Tavily 的 key **不**在 `.env` 里配置——它们按用户加密存在数据库中,
> 通过设置界面配置。`.env` 里的 key 只是基础设施机密。

改完 `.env` 后,用这个让它生效:

```bash
docker compose -f docker-compose.prod.yml up -d
```

### 更新

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build   # migrate 会自动重跑
```

### 重置(会清空所有数据)

```bash
docker compose -f docker-compose.prod.yml down -v          # -v 会连卷一起删掉
```

## C. 本地开发(热重载)

只把基础设施跑在 Docker 里,应用代码用 Bun 跑:

```bash
bun install
docker compose up -d            # 只跑基础设施 — Postgres、Qdrant、MinIO(端口发布到 localhost)
bun run db:migrate
bun run dev                      # gateway 在 :3000,客户端(Vite)在 :1420
```

- 网页预览:**http://localhost:1420**(Vite 把 `/api` 代理到 :3000 上的 gateway)。
- 原生桌面应用:`cd packages/client && bunx tauri dev`。

开发用的 `docker-compose.yml` 会把每个基础设施端口发布到 localhost(5432、6333、6334、
9000/9001),这样本地跑的 gateway 才能连上它们。完整的开发流程和隔离测试栈见
`CONTRIBUTING.md`。

## 接入 Claude Code 插件

`confer-a2a` 插件通过 HTTP 与 gateway 通信。**要按你的部署方式指向正确的 URL:**

| 你的部署方式 | `CONFER_GATEWAY_URL` |
|------------|----------------------|
| 已发布镜像或从克隆构建(方案 A/B) | `http://localhost`(nginx 在 80 端口;gateway 的 3000 没有发布) |
| 本地开发(方案 C) | `http://localhost:3000`(默认值) |
| 远程实例 | `https://your-host` |

```bash
/plugin marketplace add hyhmrright/Confer
/plugin install confer-a2a@confer
```

```bash
export CONFER_USERNAME=you
export CONFER_PASSWORD=secret
export CONFER_GATEWAY_URL=http://localhost   # 与上面的表保持一致
```

你要咨询的对端 Agent 必须已经是你账号的**联系人**(添加联系人就是那道同意闸门)。
插件完整参考见
[`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md)。

## 桌面端与移动端应用

网页版由 nginx 提供,`/api` 和 `/ws` 与页面同源,所以它不需要知道任何地址。打包后的
桌面端和 Android 版不是这样:它从 `tauri://localhost` 提供自己的资源(在 Windows、Linux
和 Android 上写作 `http://tauri.localhost`),一个相对的 `/api/v1` 会落回应用包自己身上。
所以它必须被告知要连哪个实例 —— 这个答案只有部署的人知道。

首次启动时,登录界面会多出一个「实例地址」字段,填法和上面那张表一致:

| 你的部署方式 | 填什么 |
|------------|--------|
| 已发布镜像或从克隆构建(方案 A/B) | `http://localhost` |
| 本地开发(方案 C) | `http://localhost:3000` |
| 远程实例 | `confer.example.com` |

不写协议时按 `https://` 处理,`localhost` 和 `127.0.0.1` 除外 —— 本机上没人配证书,
所以那两个按 `http://` 处理。地址只存在这台设备上;
换成另一个实例会连着登录状态一并清掉 —— token 属于签发它的那个实例,带到别处只会拿到 401。

gateway 那边相应地在 `/api/v1/*` 上放行 `tauri://localhost` 和 `http://tauri.localhost`
这两个来源。这两个来源只有用户自己机器上的 Tauri 应用能占,网页占不到;而这套 API 不带
cookie(bearer token 是当作请求头发的),所以这里放开的是"已经拿到 token 的代码可以读到
响应",不是任何环境权限。

## 把实例开放给其他人

默认这套栈监听的是明文 HTTP,自己人用没问题,但对联邦毫无用处。
**这里的 HTTPS 不是加固措施,它就是功能本身。**一个 Agent 的身份是 `did:web`,
而它的解析算法只走 https:拿到 `did:web:your.domain:agents:you` 的对端会去取
`https://your.domain/agents/you/did.json`,不会取别的。用 http 提供这个文档,
每个对端的签名校验都会在解析这一步就失败,根本轮不到看签名。

### 用 HTTPS 提供服务

`docker-compose.tls.yml` 是一个 overlay,用 Caddy 挡在整套栈前面,证书由它自己申请和续期。
它可以叠加在任意一个基础文件上:

```bash
PUBLIC_HOST=confer.example.com \
  docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml up -d
```

或者走 CLI:`npx confer-cli --domain confer.example.com`。

有三件事必须成立,在成立之前 Caddy 会一直重试(用
`docker compose … logs caddy` 观察):

- `PUBLIC_HOST` 必须是**裸域名**——不带协议,不带端口。Caddy 服务在 443,而 overlay 的
  端口映射是固定的,所以这里写 `:8443` 会监听在没有任何东西转发过来的地方。
- 那个域名的 A/AAAA 记录已经指向这台主机。
- **80 和 443** 两个端口都能从公网访问。80 不是可选的:Let's Encrypt 要先通过它完成验证,
  之后 443 上才可能有东西可服务。

这个 overlay 会把发布的端口从 `client` 容器上拿走,所以 `EXPOSE_PORT` 不再起作用。
证书存在 `caddydata` 卷里——丢了就得重新签发,而签发是有频率限制的。

### 其余事项

- 在创建账号**之前**就把 `PUBLIC_HOST` 设好。这个实例签发的每一个 DID 都由它推导而来,
  所以它不是装饰性的:留在 `localhost` 的话,你交给对端的身份会解析到*对端自己*的回环地址。
  之后再改,会在下次启动时把仍带着旧 `localhost` 默认值的身份重新挂到新域名上
  (一次性操作,有日志);而任何已经持有旧 DID 的对端必须重新添加联系人。
- 把每一个默认机密都改掉(`JWT_SECRET`、`ENCRYPTION_KEY`、数据库和 MinIO 密码)。
- 注册默认是开放的。管理员随时可以在**管理 → 配置**页关闭它(`registration_open`),
  或者在前面加一层邀请码/白名单。

自带反向代理(Traefik、已有的 nginx、云负载均衡)同样可行——跳过这个 overlay,
在你想终止 TLS 的地方终止,然后转发到 `client` 容器的 80 端口。`PUBLIC_HOST` 仍然
必须和证书上的名字一致。

### 在 Oracle Cloud 上跑免费公开实例(Always Free)

跑一个常开的公开测试实例,最便宜的办法是 Oracle Cloud 的 **Always Free** ARM 套餐
(4 OCPU / 24 GB / 10 TB 出网流量,无时间限制)。整套栈在 `arm64` 上都能构建和运行。

1. 创建一台虚拟机:规格选 **VM.Standard.A1.Flex**(最多 4 OCPU / 24 GB),镜像选
   **Ubuntu 22.04+ (arm64)**。热门区域的 ARM 容量很紧张——挑一个大区域
   (Ashburn、London),遇到 "out of capacity" 就重试。
2. 在控制台里打开 VCN 的**安全列表 / NSG**,放行入站的 **TCP 80 和 443**。
   即使你打算先不用域名,也把两个都开了——脚本会打开主机防火墙的这两个端口,
   而控制台这一半是它够不着的。
3. SSH 上去运行引导脚本(它会安装 Docker、打开主机防火墙、克隆代码、生成机密、
   构建并启动整套栈):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh | bash
   ```

   如果域名已经指向这台 VM,可以顺便一起要 HTTPS:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/hyhmrright/Confer/main/infra/oracle-bootstrap.sh \
     | CONFER_DOMAIN=confer.example.com bash
   ```

   或者先克隆再跑 `bash infra/oracle-bootstrap.sh`。它是幂等的,带上 `CONFER_DOMAIN`
   重跑一次就能把已有实例迁到那个域名上。
4. 打开它打印出来的 URL,注册,然后给自己开管理员:在 `~/Confer/.env` 里设
   `ADMIN_USERNAMES=<你>`,再用同样的 `-f` 文件重跑 `up -d gateway`。

不带 `CONFER_DOMAIN` 的话,这就是按 IP 提供明文 HTTP——测试没问题,但这个实例无法联邦,
因为 `did:web` 只走 HTTPS 解析。

## 升级 2026-08-29 之前创建的实例

Confer 现在跑的是 **PostgreSQL 18** 和 **Qdrant 1.19**;此前是 16 和 1.12。
新版本都读不了旧版本写下的存储,所以已经存有数据的实例,必须先做一次迁移才能启动。
数据不会丢,而且两种失败都很响亮:postgres 拒绝启动并说明原因,qdrant 在加载时 panic。
全新安装完全不需要这一节。

`npx confer-cli` 会在启动任何东西之前先检查 postgres 这种情况,并打印同样的指引。
如果暂时想留在旧版本,就跑当初带着它们的那个 CLI:`npx confer-cli@0.3.3`。

下面的命令里请替换成你自己的 compose 文件和项目名——从克隆部署的是
`docker-compose.prod.yml`,走 CLI 的是 `-p confer -f ~/.confer/docker-compose.ghcr.yml`。
卷的名字是 `<project>_pgdata` 和 `<project>_qdrantdata`。

**1. 备份两次。**逻辑导出和卷的字节级拷贝失败方式不同,这正是两个都要做的原因。

```bash
docker compose -f docker-compose.prod.yml exec -T postgres pg_dumpall -U confer > pg16-dumpall.sql
for v in pgdata qdrantdata; do
  docker volume create confer_${v}_backup
  docker run --rm -v confer_$v:/from -v confer_${v}_backup:/to alpine:3.24 sh -c 'cd /from && cp -a . /to/'
done
```

**2. 导出向量**——连同向量本身一起导,这样什么都不用重新做 embedding。
把输出保存为 `qdrant-export.json`:

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

**3. 替换卷并启动新版本。**删卷是不可逆的那一步;在第 1 步和第 2 步真的产出了文件、
而且你已经亲眼看过之前,不要执行它。

```bash
docker compose -f docker-compose.prod.yml down
docker volume rm confer_pgdata confer_qdrantdata
docker compose -f docker-compose.prod.yml up -d postgres qdrant --wait
```

**4. 恢复。**这份导出会重建 `confer` 角色和数据库,而新容器已经建过一遍了,
所以出现两条 `already exists` 报错是正常的;除此之外的报错都不正常。

```bash
docker compose -f docker-compose.prod.yml exec -T postgres psql -U confer -d postgres < pg16-dumpall.sql
docker compose -f docker-compose.prod.yml up -d
```

然后把向量放回去——先建 collection,因为应用只在用到时才惰性创建它们:

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

**5. 拿数据本身来验证,而不是看日志。**行数应该和旧实例一致,搜索应该能返回结果:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U confer -d confer -tAc "select count(*) from users;"
docker compose -f docker-compose.prod.yml exec -T gateway bun -e '
const j = await (await fetch("http://qdrant:6333/collections/knowledge_chunks")).json();
console.log(j.result.points_count);'
```

在你把实例正常用上一段时间之前,别删 `confer_pgdata_backup` 和
`confer_qdrantdata_backup`——它们是唯一的退路。

## 排障

| 现象 | 可能原因 / 处理 |
|---------|--------------------|
| 升级后 `postgres` 反复重启 | 它的卷是 PostgreSQL 16 写的。见[升级 2026-08-29 之前创建的实例](#升级-2026-08-29-之前创建的实例)。 |
| `qdrant` 以 101 退出并打印 panic 堆栈 | 它的存储是 Qdrant 1.12 写的。同上一节。 |
| 80 端口报 `port is already allocated` | 80 端口被别的东西占了。在 `.env` 里设 `EXPOSE_PORT=8080`,然后打开 http://localhost:8080。 |
| Web UI 能打开但每个请求都 500 | 查 `docker compose -f docker-compose.prod.yml logs gateway`。最常见的是 `JWT_SECRET` 或 `ENCRYPTION_KEY` 为空——它们在 compose 里没有默认值,必须写在 `.env` 里。 |
| `migrate` 非零退出 | Postgres 还没健康,或者 `DATABASE_URL` 写错了。重跑 `docker compose -f docker-compose.prod.yml up -d`;`migrate` 是幂等的。 |
| 插件报 `login failed` / 401 | `CONFER_GATEWAY_URL` 不对(见上面的表——生产是 80 端口,不是 3000),或者用户名/密码错了。 |
| 插件在 :3000 上报 `connection refused` | 你用的是一键部署方式;应该用 `http://localhost` 而不是 `:3000`。 |
| LLM 调用失败 | 你的用户没配 LLM key。去设置里加一个。 |
| Embedding/RAG 报错 | 见 `.claude/skills/rag-debug`,或直接跑 rag-debug skill 做 Qdrant/embedding/MinIO 诊断。 |

## 延伸阅读

- [`docs/02-architecture.md`](./02-architecture.md) — 系统架构与服务边界
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — 开发环境搭建、测试栈、约定
- [`plugins/confer-a2a/README.md`](../plugins/confer-a2a/README.md) — Claude Code 插件参考
