---
name: deploy
description: Rebuild and redeploy changed services to the local production stack (gateway, client, and the separate migrate image when a migration was added)
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

**2. 若本次改动含新迁移，必须额外重建 migrate**

`migrate` 与 `gateway` 是**两个独立镜像**（共用 `infra/gateway.Dockerfile`），
`build gateway client` **不会**带上新的迁移文件。陈旧的 migrate 跑的是旧迁移集，
却照样打印 `Migrations complete`，新表根本没建：

```bash
docker compose -f docker-compose.prod.yml build migrate && \
  docker compose -f docker-compose.prod.yml run --rm migrate
```

**3. 验证（查实际状态，不要信日志行）**

```bash
docker ps --filter name=confer- --format "{{.Names}}: {{.Status}}"
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
