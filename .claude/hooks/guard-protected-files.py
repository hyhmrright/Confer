#!/usr/bin/env python3
"""PreToolUse(Edit|Write|MultiEdit) guard: block edits to files that must never be
edited by hand.

Two classes of protected file, both project contracts:

  1. Drizzle migration state — the `.sql` files and `meta/_journal.json` under the
     migrations folder. Immutable once written: a hand-written or hand-edited SQL file
     is not recorded in the journal, so the schema silently drifts and prod needs a
     manual ALTER TABLE to recover (this bit the project once, migrations 0002-0004).
     Use `bun run db:generate`.
  2. `.env*` — live credentials. Templates (.env.example/.sample/.template) stay
     editable; the real files are edited by a human, never by a tool call.

Replaces two inline python one-liners that previously lived in settings.json, both of
which were silent no-ops: they read a TOP-LEVEL `file_path` (the path is nested under
`tool_input`), and the migration one matched `/migrations/` — a path this repo does not
have. Drizzle's `out` is `packages/gateway/drizzle`, so MIGRATION_DIRS matches on the
real folder name, with `/migrations/` kept only as a fallback if `out` is ever changed.

Exit code 2 with the reason on stderr (the channel a blocking hook is read on).
Fails open (exit 0) on any parse error so it never wedges real work.
"""
import json
import os
import sys

ENV_TEMPLATES = {".env.example", ".env.sample", ".env.template"}
# Path segments that mark a Drizzle migrations folder; `drizzle` is this repo's
# actual `out` dir (packages/gateway/drizzle), `migrations` is the conventional name.
MIGRATION_DIRS = ("/drizzle/", "/migrations/")


def violation(path):
    """Return the block reason for a protected path, or None if the edit is allowed."""
    if not path:
        return None
    name = os.path.basename(path)

    in_migrations = any(seg in path for seg in MIGRATION_DIRS)
    if in_migrations and (path.endswith(".sql") or name == "_journal.json"):
        return (
            f"BLOCKED: {name} is Drizzle migration state — immutable once written.\n"
            "Hand-written/edited SQL isn't recorded in meta/_journal.json, so the schema "
            "drifts out of sync and prod needs a manual ALTER TABLE to recover.\n"
            "Change packages/gateway/src/db/schema.ts and run `bun run db:generate` instead."
        )

    if (name == ".env" or name.startswith(".env.")) and name not in ENV_TEMPLATES:
        return (
            f"BLOCKED: {name} holds live credentials — edit it manually, not through a tool call.\n"
            "Templates (.env.example / .env.sample / .env.template) are editable; "
            "use `/sync-env` to compare key sets without exposing values."
        )

    return None


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    reason = violation((data.get("tool_input") or {}).get("file_path", ""))
    if reason:
        sys.stderr.write(reason + "\n")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
