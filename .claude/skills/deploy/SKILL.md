---
name: deploy
description: Rebuild and redeploy changed services to the local production stack (gateway, client, and the separate migrate image when a migration was added)
---

用法：`/deploy [gateway|client|both]`

在项目根目录执行。部署在 **commit 之前**（先验证效果再提交）。

**1. 按修改的包选择命令**

| 修改包 | 命令 |
|--------|------|
| `packages/client` | `bun run build && docker compose -f docker-compose.prod.yml build client && docker compose -f docker-compose.prod.yml up -d client` |
| `packages/gateway` | `bun run build && docker compose -f docker-compose.prod.yml build gateway && docker compose -f docker-compose.prod.yml up -d gateway` |
| 两者都改 / 不确定 | `bun run build && docker compose -f docker-compose.prod.yml build gateway client && docker compose -f docker-compose.prod.yml up -d gateway client` |

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
