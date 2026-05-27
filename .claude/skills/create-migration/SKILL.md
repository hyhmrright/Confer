---
name: create-migration
description: Create a new Drizzle migration file with correct naming and update the migration journal
---

创建数据库迁移的正确流程：

1. 确认 schema 变更已写入 `packages/gateway/src/db/schema.ts`
2. 在项目根目录运行：
   ```
   bun run db:generate
   ```
   这会自动生成正确命名的 SQL 文件并更新 `meta/_journal.json`
3. 检查生成的迁移文件内容是否符合预期
4. 运行 `bun run db:migrate` 应用到本地数据库并验证
5. 生产环境额外步骤：
   ```
   docker compose -f docker-compose.prod.yml up migrate --build
   ```

**禁止**直接手写 SQL 文件放入 migrations 目录 — Drizzle journal 不会感知，
会导致迁移状态不同步（本项目曾因此需要手动 ALTER TABLE 修复）。
