#!/usr/bin/env python3
"""PreToolUse(Bash) guard: block `bun test ...` and nudge to `bun run test`.

`bun test` invokes Bun's built-in test runner directly, bypassing the package's
configured test script. That script (via bunfig.toml) preloads src/test/setup.ts,
which loads the test env and truncates tables between tests against the isolated
test stack. Run as `bun test`, none of that wiring fires, so tests point at — and
pollute — the shared dev DB. `bun run test` runs the configured script instead.

Blocks only the `bun test` subcommand in command position; `bun run test`,
`bun run test:setup`, etc. pass through, as does `bun`/`test` appearing as mere
arguments (e.g. `echo bun test`). Exit code 2 with the reason on stderr (the
channel a blocking hook is read on). Fails open (exit 0) on any parse uncertainty
so it never wedges work.
"""
import json
import re
import shlex
import sys

# A leading `VAR=value` env assignment (e.g. `CI=1 bun test`).
ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")


def is_bun_test(segment):
    """True if this command segment runs Bun's `test` subcommand directly.

    Only the command-position token counts: `bun test` and `CI=1 bun test` block,
    but `echo bun test` / `ls bun test` (bun/test as mere arguments) do not.
    """
    s = segment.strip()
    if not s:
        return False
    try:
        tokens = shlex.split(s)
    except ValueError:
        return False  # unparseable (quoting/$()) -> fail open
    # Skip leading env assignments to reach the program token.
    i = 0
    while i < len(tokens) and ASSIGN.match(tokens[i]):
        i += 1
    if i >= len(tokens):
        return False
    prog = tokens[i]
    # Match `bun` even behind a path prefix (/usr/bin/bun); ignore flags after it.
    if prog != "bun" and not prog.endswith("/bun"):
        return False
    rest = [t for t in tokens[i + 1 :] if not t.startswith("-")]
    return bool(rest) and rest[0] == "test"


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
                "`bun test` runs Bun's built-in runner directly, bypassing the "
                "package's configured test script (bunfig.toml preload: test env + "
                "per-test table truncation against the isolated test stack). Run as "
                "`bun test`, it points at and pollutes the shared dev DB instead. "
                "`bun run test` runs the configured, isolated test script.\n"
            )
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
