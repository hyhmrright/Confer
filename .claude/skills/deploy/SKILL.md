---
name: deploy
description: Rebuild and redeploy changed services to the local production stack (gateway, client, and the migrate job that shares the gateway's image)
---

用法：`/deploy [gateway|client|both]`

在项目根目录执行。部署在 **commit 之前**（先验证效果再提交）。

**1. 按修改的包选择命令**

| 修改包 | 命令 |
|--------|------|
| `packages/client` | `./infra/deploy.sh client` |
| `packages/gateway` | `./infra/deploy.sh gateway` |
| 两者都改 / 不确定 | `./infra/deploy.sh` |

脚本内部就是原来那串 `bun run build && docker compose build && up -d`，只是在
build **之前**先把即将被顶掉的镜像重 tag 为 `:previous`。`docker compose build`
会就地覆盖 `:latest`，旧镜像随即失去名字、被下一次 prune 回收 —— 那样出了问题就
没有退路了。

**2. 迁移无需任何额外命令**

`migrate` 跑的就是 **gateway 自己那个镜像**（一个 tag、两条 command），prod 和
ghcr 两条路都是。所以重建 gateway 就等于刷新了迁移集。

2026-09-20 之前 prod 把它单独建成 `confer-migrate:latest`，那个拆分正是这一步过去
需要人记住的全部原因：`build gateway client` 不碰它，陈旧镜像跑旧迁移集，却照样打印
`Migrations complete`，新表根本没建。共用 tag 之后这类失败不再可能发生。

老机器上会剩一个没人引用的 `confer-migrate:latest`。它和 gateway 镜像的层完全相同，
纯属死重量，但因为还带着名字，`docker image prune` 永远不会回收它 ——
第一次按新布局部署后 `docker image rm confer-migrate:latest` 删掉即可。

**跑**它从来不是缺的那一半：`gateway` 的 `depends_on` 写了
`migrate: condition: service_completed_successfully`，任何会起 gateway 的 `up`
都会先把它拉起来、等它退出 0 再起 gateway —— 这也正是单向迁移需要的顺序。

**3. 验证（查实际状态，不要信日志行）**

```bash
# -a：migrate 是跑完就退的 job 容器，不带 -a 根本看不见它
docker ps -a --filter name=confer- --format "{{.Names}}: {{.Status}}"
docker logs confer-gateway-1 --tail 5
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/
```

有迁移时，另查真实的表/列和 journal 条数确认已落库 —— `Migrations complete`
这行日志不能作为迁移已应用的证据：

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U confer -d confer -c "\dt" -c "select count(*) from drizzle.__drizzle_migrations;"
```

**4. 部署坏了要退回**

```bash
./infra/rollback.sh          # 默认 gateway client
./infra/rollback.sh gateway  # 只退一个
```

把 `:latest` 指回上次部署留下的 `:previous` 并重建容器。没有 `:previous`
（该服务从未经 `deploy.sh` 部署过）时明确报错退出，不会静默假装成功。

**它只退代码。** 迁移是单向的：被退掉的那次部署如果带了新迁移，迁移早已应用，
旧镜像面对的是新 schema。退之前先看 `packages/gateway/drizzle` 在那次部署里
有没有新增文件。
