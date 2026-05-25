#!/usr/bin/env bash
# Generates trilingual GitHub release notes from conventional commits.
# Usage: gen-release-notes.sh <tag> [prev-tag]
# Outputs Markdown to stdout.

set -euo pipefail

TAG="${1:-}"
PREV_TAG="${2:-}"
DATE=$(date -u +"%Y-%m-%d")
REPO="${GITHUB_REPOSITORY:-hyhmrright/Confer}"

if [[ -z "$TAG" ]]; then
  echo "Usage: $0 <tag> [prev-tag]" >&2
  exit 1
fi

if [[ -z "$PREV_TAG" ]]; then
  PREV_TAG=$(git describe --tags --abbrev=0 "${TAG}^" 2>/dev/null || echo "")
fi

if [[ -n "$PREV_TAG" ]]; then
  COMMIT_RANGE="${PREV_TAG}..${TAG}"
else
  COMMIT_RANGE="${TAG}"
fi

# Collect commits by type
feats=()
fixes=()
security=()
perf=()
docs_items=()

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  hash="${line%% *}"
  msg="${line#* }"

  if echo "$msg" | grep -qiE '^(fix|security)\(.*security|^security:'; then
    security+=("$msg ($hash)")
  elif echo "$msg" | grep -qE '^feat(\(.+\))?!?:'; then
    feats+=("$msg ($hash)")
  elif echo "$msg" | grep -qE '^fix(\(.+\))?!?:'; then
    fixes+=("$msg ($hash)")
  elif echo "$msg" | grep -qE '^perf(\(.+\))?!?:'; then
    perf+=("$msg ($hash)")
  elif echo "$msg" | grep -qE '^docs(\(.+\))?!?:'; then
    docs_items+=("$msg ($hash)")
  fi
done < <(git log "$COMMIT_RANGE" --pretty=format:"%h %s" 2>/dev/null || true)

# Helper: emit a section in one language
emit_section() {
  local header="$1"; shift
  local -n items=$1
  if [[ ${#items[@]} -gt 0 ]]; then
    echo "### $header"
    for item in "${items[@]}"; do
      # Strip conventional commit prefix for readability
      clean=$(echo "$item" | sed -E 's/^(feat|fix|security|perf|docs)(\([^)]+\))?!?: //')
      echo "- $clean"
    done
    echo ""
  fi
}

has_content() {
  [[ ${#feats[@]} -gt 0 || ${#fixes[@]} -gt 0 || ${#security[@]} -gt 0 || ${#perf[@]} -gt 0 || ${#docs_items[@]} -gt 0 ]]
}

# ── Preamble ────────────────────────────────────────────────────────────────
cat <<EOF
# 🚀 Confer ${TAG}

> **A2A Protocol Platform** — Let your AI Agent speak for you.
> **AI 代理通信平台** — 让 AI Agent 代你发声。
> **A2Aプロトコルプラットフォーム** — AIエージェントに語らせよう。

📅 ${DATE}$( [[ -n "$PREV_TAG" ]] && echo " · 🔖 Changes since [$PREV_TAG](https://github.com/${REPO}/releases/tag/${PREV_TAG})" || true )

---

EOF

# ── English ─────────────────────────────────────────────────────────────────
cat <<'EOF'
## 🇬🇧 English

EOF

if has_content; then
  emit_section "✨ New Features" feats
  emit_section "🐛 Bug Fixes" fixes
  emit_section "🔒 Security" security
  emit_section "⚡ Performance" perf
  emit_section "📖 Documentation" docs_items
else
  echo "_No conventional commits found — edit this section manually._"
  echo ""
fi

cat <<'EOF'
---

## 🇨🇳 中文

> **注**：以下条目由英文自动映射，发布前请检查并完善翻译。

EOF

if has_content; then
  [[ ${#feats[@]} -gt 0 ]]      && { echo "### ✨ 新功能"; for i in "${feats[@]}";      do echo "- $(echo "$i" | sed -E 's/^(feat)(\([^)]+\))?!?: //')"; done; echo ""; }
  [[ ${#fixes[@]} -gt 0 ]]      && { echo "### 🐛 问题修复"; for i in "${fixes[@]}";      do echo "- $(echo "$i" | sed -E 's/^(fix)(\([^)]+\))?!?: //')"; done; echo ""; }
  [[ ${#security[@]} -gt 0 ]]   && { echo "### 🔒 安全"; for i in "${security[@]}";   do echo "- $(echo "$i" | sed -E 's/^(fix|security)(\([^)]+\))?!?: //')"; done; echo ""; }
  [[ ${#perf[@]} -gt 0 ]]       && { echo "### ⚡ 性能"; for i in "${perf[@]}";       do echo "- $(echo "$i" | sed -E 's/^(perf)(\([^)]+\))?!?: //')"; done; echo ""; }
  [[ ${#docs_items[@]} -gt 0 ]] && { echo "### 📖 文档"; for i in "${docs_items[@]}"; do echo "- $(echo "$i" | sed -E 's/^(docs)(\([^)]+\))?!?: //')"; done; echo ""; }
else
  echo "_暂无自动提取内容，请手动填写。_"
  echo ""
fi

cat <<'EOF'
---

## 🇯🇵 日本語

> **注**：以下はコミットから自動生成されたドラフトです。公開前に翻訳を確認してください。

EOF

if has_content; then
  [[ ${#feats[@]} -gt 0 ]]      && { echo "### ✨ 新機能"; for i in "${feats[@]}";      do echo "- $(echo "$i" | sed -E 's/^(feat)(\([^)]+\))?!?: //')"; done; echo ""; }
  [[ ${#fixes[@]} -gt 0 ]]      && { echo "### 🐛 バグ修正"; for i in "${fixes[@]}";      do echo "- $(echo "$i" | sed -E 's/^(fix)(\([^)]+\))?!?: //')"; done; echo ""; }
  [[ ${#security[@]} -gt 0 ]]   && { echo "### 🔒 セキュリティ"; for i in "${security[@]}";   do echo "- $(echo "$i" | sed -E 's/^(fix|security)(\([^)]+\))?!?: //')"; done; echo ""; }
  [[ ${#perf[@]} -gt 0 ]]       && { echo "### ⚡ パフォーマンス"; for i in "${perf[@]}";       do echo "- $(echo "$i" | sed -E 's/^(perf)(\([^)]+\))?!?: //')"; done; echo ""; }
  [[ ${#docs_items[@]} -gt 0 ]] && { echo "### 📖 ドキュメント"; for i in "${docs_items[@]}"; do echo "- $(echo "$i" | sed -E 's/^(docs)(\([^)]+\))?!?: //')"; done; echo ""; }
else
  echo "_自動抽出なし — 手動で記入してください。_"
  echo ""
fi

# ── Download & Install ───────────────────────────────────────────────────────
cat <<EOF
---

## 📦 Download & Install · 下载安装 · ダウンロード

| Platform | File |
|----------|------|
| 🍎 macOS (Apple Silicon) | \`Confer_${TAG}_aarch64.dmg\` |
| 🍎 macOS (Intel) | \`Confer_${TAG}_x64.dmg\` |
| 🪟 Windows (x64) | \`Confer_${TAG}_x64-setup.exe\` |
| 🪟 Windows (ARM64) | \`Confer_${TAG}_arm64-setup.exe\` |
| 🐧 Linux (x64) | \`Confer_${TAG}_amd64.AppImage\` |
| 🤖 Android APK | \`Confer_${TAG}.apk\` |

### Server · 服务端 · サーバー

\`\`\`bash
# Clone & start with Docker Compose
git clone https://github.com/${REPO} && cd Confer
cp .env.example .env        # Edit PUBLIC_HOST, JWT_SECRET, ENCRYPTION_KEY
docker compose up -d
\`\`\`

---

## 🔗 Links · 链接 · リンク

| | |
|---|---|
| 📖 Documentation | [docs/](https://github.com/${REPO}/tree/main/docs) |
| 🐛 Report a Bug | [Issues](https://github.com/${REPO}/issues/new?labels=bug) |
| 💡 Feature Request | [Discussions](https://github.com/${REPO}/discussions) |
| 🔒 Security | [SECURITY.md](https://github.com/${REPO}/blob/main/SECURITY.md) |

---

<sub>Built with Tauri 2.0 · Bun · Hono · A2A Protocol · DID:web · RFC 9421</sub>
EOF
