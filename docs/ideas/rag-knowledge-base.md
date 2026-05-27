# RAG 知识库增强

## Problem Statement
如何让 AI 在对话中自动检索多个私有知识库，给出有引用来源的精准回答？

## Recommended Direction
**智能检索引擎 + 活知识库架构预留**

以"知识库搜索"作为 LLM 工具（类似现有的 Tavily 网页搜索），由 LLM 自主判断何时触发、查哪个库。检索采用两阶段：Qdrant 语义召回 Top-20，cross-encoder 重排取 Top-5，结果附带文档来源元数据，回答末尾显示引用卡片。

数据模型设计为 `knowledge_sources`（支持 file / url / confluence 类型）+ `knowledge_chunks`（Qdrant collection），为后续订阅式同步预留扩展点，MVP 阶段只实现 file 类型。

## MVP Scope

**In:**
- 知识库 CRUD（创建/命名/删除知识库）
- 文件导入：.txt / .md / .pdf / .docx（服务端解析分块）
- Qdrant embedding 存储（按知识库 namespace 隔离）
- `search_knowledge_base(query, kb_ids[])` 作为 LLM 工具
- 混合路由：LLM 按需调用知识库搜索 or Tavily or 两者
- 引用来源显示（文档名 + 片段预览卡片）
- 对话内选择启用哪些知识库

**Not Doing（及原因）:**
- URL/Sitemap 订阅爬取 — 需要额外爬取服务，架构留口，MVP 后加
- Confluence/Notion API 对接 — 企业认证复杂，v0.2
- 知识图谱 / 实体关系抽取 — 数据量小时效果不如简单 RAG，v0.3+
- Embedding 模型自托管 — 先用 OpenAI text-embedding-3-small，验证后再考虑
- 权限细粒度控制（知识库共享给团队成员）— MVP 单用户

## Key Assumptions to Validate
- [ ] text-embedding-3-small 中文效果足够好 — 用真实 wiki 内容测试
- [ ] LLM 能可靠判断何时查知识库 — A/B 测试 with/without tool
- [ ] 用户愿意手动上传文件（而非自动同步）— 观察上传频率

## Open Questions
- Reranker 用 Cohere rerank API 还是本地 BGE-reranker？（影响延迟和成本）
- PDF 解析用 pdf-parse 还是调用 LLM vision？（影响图表处理能力）
