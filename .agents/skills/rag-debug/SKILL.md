---
name: rag-debug
description: Diagnose RAG pipeline issues — check Qdrant collection, embedding provider, MinIO storage, and recent chunk uploads
---

按顺序执行以下诊断步骤，汇总哪一步有问题并给出修复建议：

**1. Qdrant 集合状态**
```bash
curl -s http://localhost:6333/collections/knowledge_chunks | jq '{points: .result.points_count, status: .result.status}'
```
预期：`status: "green"`，`points > 0`（若已上传文档）

**2. 最近嵌入日志**
```bash
docker logs confer-gateway-1 2>&1 | grep -E 'embed|chunk|qdrant|vector' | tail -20
```
检查是否有错误（400 Bad Request 通常是 ULID 未转 UUID）

**3. Embedding provider 生效情况**
检查 `packages/gateway/src/lib/embedding.ts` 中 `EMBEDDING_PROVIDER_PRIORITY` 顺序，
用户的 key 存在 `users.llm_keys_json`，不是容器环境变量；通过设置 UI 或现有按用户解密的服务路径确认 provider，仅报告是否配置，不输出 key。以下命令只能检查旧式环境变量，不能证明用户实际使用的 provider：
```bash
docker exec confer-gateway-1 env | grep -E 'OPENAI_API_KEY|GLM_API_KEY|QWEN_API_KEY' | sed 's/=.*/=***/'
```

**4. MinIO 存储状态**
```bash
docker exec confer-minio-1 mc ls local/knowledge-docs/ 2>/dev/null | tail -10
```
若 mc 未配置，改用：
```bash
docker logs confer-minio-1 2>&1 | grep -E 'PUT|GET|ERROR' | tail -10
```

**5. Gateway 服务健康**
```bash
docker ps --filter name=confer-gateway --format "{{.Names}}: {{.Status}}"
```

**常见问题速查**：
- Qdrant 400 → ULID 未转 UUID，检查 `toUUID()` 是否调用
- 嵌入维度不匹配 → 先检查 `toVectorSize` 对齐到 `VECTOR_SIZE` 的路径与 collection 配置；不要自动删除 collection，保留已有数据
- MinIO 连接拒绝 → Docker 网络用 `minio:9000`，不能用 `localhost:9000`
- 无日志输出 → 检查 stream.ts 中 RAG tool 是否注册到当前 conversation 类型
