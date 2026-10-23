# 开发状态核对

核对日期：2026-10-16。对照 `08-mvp-backlog.md`、历史提交及当前源码；这是代码核对，不代表所有功能已完成现场验收。

## 已实现，避免重复开发

| 功能 | 证据与边界 |
|---|---|
| 跨对话长期记忆 | `packages/gateway/src/tools/memory.ts`、`lib/memory-extract.ts`、`lib/memory-store.ts` 及集成测试；旧设计仍标“待实现”，应以代码为准 |
| 开发工具咨询与项目记忆 | MCP 已有 15 个工具，`packages/mcp-a2a/src/tools/project-memory.ts` 使用服务端 Markdown 记忆；不等于本地项目文件同步 |
| 跨语言回答 | `packages/gateway/src/a2a/answer.ts` 将询问语言传入回答流程；不能据此认为原文与译文双语引用已实现 |
| 联系人配额与限流 | `packages/gateway/src/routes/a2a-rate-limit.integration.test.ts`；不能据此认为路线图的全部四维限流已完成 |
| 账号安全与个人 API 令牌 | `routes/account-security.ts`、`routes/api-tokens.ts` 及集成测试；个人令牌不等于跨 Agent capability token |
| 会话搜索、导出、归档、未读 | `packages/gateway/src/routes/conversations.ts`、`routes/search.integration.test.ts` |

## 尚未完成或仅有基础结构

| 优先级 | 工作 | 当前边界 / 开工条件 |
|---|---|---|
| MVP | Capability token 签发与验证 | `03-protocol.md` 有设计，identity 和入站链路未实现对应授权令牌；需先明确签发主体、scope、过期、撤销及与两种 A2A binding 的关系 |
| 已实现 | 本地最近 100 条消息缓存 | 桌面使用 Tauri 命令 + SQLite，Web 使用浏览器存储；按实例/账号/会话隔离，退出清理，7 天过期，最多保留 20 个会话；服务器刷新是权威来源 |
| MVP | 可复现的 mock-vendor 演示 | 现有演示 GIF 不等于可部署 demo peer、X100 手册和端到端演示脚本；公开部署需要域名与运行环境 |
| v0.2 | OAuth-style 工具账号绑定 | MCP 仍通过环境变量用户名/密码登录，见 `packages/mcp-a2a/src/config.ts` |
| v0.2 | 项目配置与本地 Markdown 记忆 | 尚无 `.claude/confer.toml` 解析及 peers 目录同步；迁移后应先确定 Codex 与 Claude 共用路径，避免重新绑定到单一工具 |
| v0.2 | peer 管理/咨询 CLI | 已有 `confer-cli` 是自托管安装工具，不等于路线图中的 add/list/ask/sync CLI |
| v0.3+ | 群聊、成员管理、SSO、跨实例 fan-out | `group` 类型和 participant 表只是基础结构；不能作为完整产品能力验收 |
| v1.0 | 完整可观测性、自动备份恢复 | 路线图仍未完成；需要独立的运行与恢复验收 |

后续版本功能按项目规则单独确认范围后推进。移动端已有构建配置，但不据此将 iOS/Android 完整体验标为已交付。

## 本次补齐

聊天会话切换时的异步隔离：初始消息、历史分页、发送后的回答流及失败状态只能更新发起操作的那一次会话视图。快速 A → B → A 也不会重新接纳第一次打开 A 的旧请求。切走后的原始回答流继续消费，使服务端原会话的回答得以完成；重新进入时通过历史和 WebSocket 获取结果。

新增回归测试覆盖旧请求成功/失败、分页返回、回答/错误/断流、发送请求延迟。下一项为 capability token，其他尚未完成项继续保留。


## 本地消息缓存补齐

2026-10-16：Tauri 受限的缓存命令在应用目录的 `messages.db` 保存消息快照，原生查询经 SeaQuery 构建，建表迁移由客户端的 `bun run db:generate` 生成；Web 保留相同行为，使用浏览器存储。每会话最多 100 条消息，全局最多 20 个会话，7 天过期。缓存读取后继续请求服务器，成功时以服务器页面替换，网络故障时保留快照；403/404 清除已失权/已删除会话，用户主动删除会话亦清除缓存。退出清除持久缓存，并使旧会话请求和流失效。

缓存不提供离线发信或可靠离线数据库；SQLite 和浏览器存储由操作系统/浏览器保护，没有单独加密。桌面升级需要重新构建安装包，localhost 部署只更新 Web 客户端。

## 剩余实施顺序

用户已授权继续覆盖后续版本范围。按照依赖推进：capability token → 本地共享项目配置/Markdown 同步与 peer CLI → 工具账号绑定 → 群聊、成员和跨实例分发 → 可配置 SSO → 可观测性与备份恢复。演示素材和本地演示脚本并行穿插。公开实例需要域名/运行环境，SSO 的现场验收需要身份提供商信息；这些配置未提供前只能验收本地或测试身份提供商。
