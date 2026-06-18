#!/usr/bin/env python3
"""PreToolUse(Bash) guard: block `bun test ...` and nudge to `bun run test`.

`bun test` invokes Bun's built-in test runner directly, skipping the package's
bunfig.toml preload (src/test/setup.ts loads test env + truncates tables between
tests). Run that way, tests point at — and pollute — the shared dev stack; this
once produced ~102 phantom failures. `bun run test` runs the package's configured
test script, which wires up the isolated test stack instead.

Blocks only the `bun test` subcommand; `bun run test`, `bun run test:setup`, etc.
pass through. Exit code 2 with the reason on stderr (the channel a blocking hook
is read on). Fails open (exit 0) on any parse uncertainty so it never wedges work.
"""
import json
import re
import shlex
import sys


def is_bun_test(segment):
    """True if this command segment runs Bun's `test` subcommand directly."""
    s = segment.strip()
    if not s:
        return False
    try:
        tokens = shlex.split(s)
    except ValueError:
        return False  # unparseable (quoting/$()) -> fail open
    for i, tok in enumerate(tokens):
        # Match `bun` even behind env assignments or a path prefix (/usr/bin/bun).
        if tok == "bun" or tok.endswith("/bun"):
            rest = [t for t in tokens[i + 1 :] if not t.startswith("-")]
            return bool(rest) and rest[0] == "test"
    return False


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    if data.get("tool_name") != "Bash":
        return 0
    cmd = (data.get("tool_input") or {}).get("command", "")
    if not cmd.strip():
        return 0
    for segment in re.split(r"\|\||&&|[|;&\n]", cmd):
        if is_bun_test(segment):
            sys.stderr.write(
                "BLOCKED: use `bun run test`, not `bun test`.\n"
                "`bun test` runs Bun's built-in runner directly, skipping the "
                "bunfig.toml preload (test env + per-test table truncation) and "
                "pointing tests at the shared dev stack — this caused ~102 phantom "
                "failures once. `bun run test` runs the configured, isolated test "
                "script.\n"
            )
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
