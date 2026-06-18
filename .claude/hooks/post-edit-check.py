#!/usr/bin/env python3
"""PostToolUse(Edit|Write|MultiEdit): format the edited file with Biome, then
type-check the package that file belongs to. Stays silent unless tsc errors.

Reads the edited path from tool_input.file_path. The earlier inline hooks read a
top-level `file_path` that is always empty in this payload (the same nesting bug
that once silently disabled the migrations/.env guards), so Biome ran on zero
files and the type-check never covered the client package — client is excluded
from the root tsconfig, so its files reached CI/build with no on-edit feedback.

This routes client files to the client tsconfig and everything else to the root
tsconfig, closing that gap. Fails open (exit 0) on any error so it never wedges
an edit.
"""
import json
import os
import subprocess
import sys

# Repo root, derived from this file's location (.claude/hooks/<this>) so the
# tracked hook stays portable across checkouts instead of hardcoding a path.
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BIOME = "./node_modules/.bin/biome"
TSC = "./node_modules/.bin/tsc"
FORMAT_EXTS = {".ts", ".tsx", ".js", ".jsx", ".json", ".jsonc", ".css"}
TS_EXTS = {".ts", ".tsx"}


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    path = (data.get("tool_input") or {}).get("file_path", "")
    if not path:
        return 0
    ext = os.path.splitext(path)[1].lower()

    # 1. Format just the edited file, in place.
    if ext in FORMAT_EXTS:
        subprocess.run([BIOME, "check", "--write", path], cwd=REPO, capture_output=True)

    # 2. Type-check the owning tsconfig project (tsc has no single-file mode). The
    #    client package is excluded from the root tsconfig, so route its files to
    #    the client project — otherwise their type errors are never caught here.
    if ext in TS_EXTS:
        rel = os.path.relpath(os.path.abspath(path), REPO)
        project = (
            "packages/client/tsconfig.json"
            if rel.startswith("packages/client/")
            else "tsconfig.json"
        )
        result = subprocess.run(
            [TSC, "-p", project], cwd=REPO, capture_output=True, text=True
        )
        errors = [
            line
            for line in (result.stdout + result.stderr).splitlines()
            if "error TS" in line
        ]
        if errors:
            print("\n".join(errors[:10]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
