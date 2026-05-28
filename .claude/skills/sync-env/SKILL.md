---
name: sync-env
description: Check that all keys in .env.example exist in .env and report missing or undocumented keys (values are never shown)
disable-model-invocation: true
---

比较 `.env.example` 和 `.env` 的 key 列表（仅输出 key 名，不输出任何 value）：

```bash
cd /Users/hyh/code/Confer

# 提取 key 列表（忽略注释和空行）
example_keys=$(grep -E '^[A-Z_]+=?' .env.example | cut -d= -f1 | sort)
env_keys=$(grep -E '^[A-Z_]+=?' .env | cut -d= -f1 | sort)

echo "=== 在 .env.example 中定义但 .env 中缺失（需要配置）==="
comm -23 <(echo "$example_keys") <(echo "$env_keys")

echo ""
echo "=== 在 .env 中存在但 .env.example 中未文档化（需要补充示例）==="
comm -13 <(echo "$example_keys") <(echo "$env_keys")

echo ""
echo "=== 统计 ==="
echo "example keys: $(echo "$example_keys" | wc -l | tr -d ' ')"
echo "env keys:     $(echo "$env_keys" | wc -l | tr -d ' ')"
```

**输出说明**：
- 第一节为空 → .env 配置完整
- 第二节有内容 → 需将对应 key（用占位符 value）补充到 `.env.example`
- 两节均为空 → ✅ 完全同步
