---
name: deploy
description: Rebuild and redeploy a changed service to production (gateway, client, or both)
---

用法：`/deploy [gateway|client|both]`

根据修改的包选择命令：

| 修改包 | 命令 |
|--------|------|
| `packages/gateway` | `bun run build && docker compose -f docker-compose.prod.yml build gateway && docker compose -f docker-compose.prod.yml up -d gateway` |
| `packages/client` | `bun run build && docker compose -f docker-compose.prod.yml build client && docker compose -f docker-compose.prod.yml up -d client` |
| 两者都改 / 不确定 | `bun run build && docker compose -f docker-compose.prod.yml build gateway client && docker compose -f docker-compose.prod.yml up -d gateway client` |

部署完成后验证：
- `docker logs confer-gateway-1 --tail 5` — 确认 gateway 已启动
- 访问 http://localhost/ — 确认 client 正常加载

**注意**：部署在 commit 之前执行（先验证效果再提交）。
