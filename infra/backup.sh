#!/usr/bin/env bash
# Encrypted full-stack backups; `verify` restores into disposable isolated services.
set -euo pipefail
cd "$(dirname "$0")/.."
exec bun run packages/gateway/src/backup/cli.ts "$@"
