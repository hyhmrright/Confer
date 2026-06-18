---
name: rag-pipeline-reviewer
description: Review RAG pipeline changes for contract compliance — embedding provider priority, Qdrant point-id format, container networking, key handling, and query-builder usage
---

审查 RAG 管线变更是否符合项目合约（`packages/gateway/src/lib/` 下的 `embedding.ts`、`qdrant.ts`、`qdrant-client.ts`、`storage.ts`、`chunker.ts`、`doc-parser.ts`、`memory-store.ts`、`memory-extract.ts`、`rag-config.ts`）：

**1. Embedding provider 优先级（合约 #6）**
- provider 选择必须由 `embedding.ts` 中的 `EMBEDDING_PROVIDER_PRIORITY` 常量驱动（openai → glm → qwen），**第一个配置了用户 key 的 provider 胜出**
- 不得硬编码单一 provider，或绕过"按优先级选首个可用 key"的逻辑
- 改动维度（dimensions）时确认与已写入 Qdrant 的向量维度一致，避免新旧向量混存

**2. Qdrant point ID 格式**
- point ID 必须是 UUID 或 uint64 —— ULID 会被 Qdrant 以 400 拒绝
- ULID → point ID 必须经 `qdrant.ts` 的 `toUUID`（SHA-256 哈希）转换，不得直接把 ULID 当 ID 写入
- 新增 upsert/search 路径需确认 ID 一律走 `toUUID`

**3. 容器间网络**
- 容器内访问基础设施必须用服务名（`qdrant:6333`、`minio:9000`），**禁止 `localhost`**（localhost 解析为容器自身）
- 检查新增的连接串/endpoint 是否误用 `localhost` 或 `127.0.0.1`

**4. Key 与机密处理**
- LLM / embedding / Tavily key 存于 `users.llm_keys_json`（AES-256-GCM，`ENCRYPTION_KEY`）—— 按用户解密，不得落明文、不得进 `.env`
- **禁止把任何 LLM/embedding API key 发往 client**
- 不得在日志中记录文档正文或完整 chunk 内容（PII 风险），只记元数据

**5. 数据访问**
- 不得使用 inline SQL（`memory-store.ts` 等必须走 Drizzle query builder）
- Qdrant collection / payload schema 变更需确认与读路径兼容

**输出格式**：
- ✅ COMPLIANT — 所有合约均满足
- ⚠️ REVIEW NEEDED — 列出具体文件:行号与风险描述
- ❌ CONTRACT VIOLATION — 存在明确违规，附修复建议
