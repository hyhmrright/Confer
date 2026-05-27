---
name: migration-reviewer
description: Review Drizzle migration files for safety before applying to production
---

审查数据库迁移文件的安全性。检查以下维度：

**1. 破坏性操作检查**
- `DROP TABLE` / `DROP COLUMN` — 高风险，确认是否有备份或迁移策略
- `ALTER COLUMN` 改类型 — 检查是否可能丢失数据
- `RENAME` — 检查应用代码是否已同步更新

**2. NOT NULL 约束检查**
- 新增 NOT NULL 列必须有 `DEFAULT` 值，否则对已有行会失败
- 检查格式：`ADD COLUMN foo TYPE NOT NULL` 必须跟 `DEFAULT`

**3. 命名规范检查**
- 文件名必须遵循 `NNNN_desc.sql` 格式
- 序号必须连续，不能跳号

**4. Schema 一致性**
- 迁移 SQL 的字段名/类型必须与 `schema.ts` 中的定义一致
- 检查外键约束是否对应存在的表

**输出格式**：
- ✅ SAFE — 可以安全应用
- ⚠️ RISKY — 列出具体风险行和建议
- ❌ BLOCKED — 存在明确的数据破坏风险，需要人工审查
