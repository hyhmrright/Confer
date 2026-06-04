#!/usr/bin/env python3
"""PreToolUse guard: block using Bash cat/head/tail/sed to VIEW a file; nudge to the Read tool.

Why: viewing a file through Bash does not register a tracked read in the harness, so a
following Edit/Write fails with "File has not been read yet"; it also violates the project
rule to use the Read tool for file contents. This guard blocks only the "viewing a file"
shapes and deliberately allows the legitimate uses of these tools:

  - downstream of a pipe (`cat f | jq`, `head -100 f | grep x`) -> data processing, not viewing
  - any redirect / heredoc (`cat f > out`, `cat <<EOF > f`)      -> writing, not viewing
  - `tail -f` / `tail -F`                                        -> log follow (Read can't do it)
  - `sed -i ...`                                                 -> in-place edit, not viewing
  - viewers reading stdin (no file operand)                      -> piped input

Block decision uses exit code 2 with the reason on stderr (the channel Claude reads on a
blocking hook). On any parse uncertainty it fails OPEN (exit 0) so it never wedges real work.
"""
import sys
import json
import re
import shlex

VIEWERS = {"cat", "head", "tail", "sed"}


def split_with_seps(cmd):
    """Split a command line into (segment, following_separator) pairs.

    Separators recognised: || && | ; & and newline. The separator that FOLLOWS a
    segment tells us whether that segment's stdout is piped onward ("|") — in which
    case the segment is feeding a processor, not being shown to a human.
    """
    parts = re.split(r"(\|\||&&|[|;&\n])", cmd)
    pairs = []
    i = 0
    while i < len(parts):
        seg = parts[i]
        sep = parts[i + 1] if i + 1 < len(parts) else ""
        pairs.append((seg, sep))
        i += 2
    return pairs


def file_view_target(seg, sep):
    """Return the viewed filename if this segment views a file, else None."""
    s = seg.strip()
    if not s:
        return None
    if sep == "|":
        return None  # output piped to a consumer -> processing, not viewing
    if re.search(r"<<|>>|>", s):
        return None  # redirect / heredoc -> writing, not viewing
    try:
        tokens = shlex.split(s)
    except ValueError:
        return None  # unparseable (quoting/$()) -> fail open
    if not tokens:
        return None
    prog = tokens[0]
    if prog not in VIEWERS:
        return None
    args = tokens[1:]

    if prog == "tail" and any(
        a in ("-f", "-F", "--follow") or a.startswith("--follow") for a in args
    ):
        return None  # following a log; the Read tool can't do this

    if prog == "sed":
        if any(a == "-i" or a.startswith("-i") or a.startswith("--in-place") for a in args):
            return None  # in-place edit, not viewing
        if "-n" not in args:
            return None  # only flag the explicit print-a-range view shape: sed -n '..p' file
        operands = [a for a in args if not a.startswith("-")]
        # operands[0] is the sed script; a real view needs a file operand after it
        if len(operands) < 2:
            return None
        return operands[-1]

    # cat / head / tail: collect file operands, honouring value-taking flags.
    files = []
    if prog in ("head", "tail"):
        skip = False
        for a in args:
            if skip:
                skip = False
                continue
            if a in ("-n", "-c", "--lines", "--bytes"):
                skip = True  # these take a separate numeric value
                continue
            if a.startswith("-"):
                continue
            files.append(a)
    else:  # cat — all flags are valueless (-n, -b, -A, -E, -T, -v, -s)
        for a in args:
            if a.startswith("-") and a != "-":
                continue
            files.append(a)

    files = [f for f in files if f != "-"]
    if not files:
        return None  # no file operand -> reading stdin -> allow
    return " ".join(files)  # name every viewed file in the block reason


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0  # never break the tool flow on a parse error
    if data.get("tool_name") != "Bash":
        return 0
    cmd = (data.get("tool_input") or {}).get("command", "")
    if not cmd.strip():
        return 0
    # Strip trailing line comments first (per line, before pipeline splitting) so a
    # `#`-annotation isn't mistaken for a filename and its `|`/`>` chars can't shadow
    # real separators. A `#` inside a quoted filename is rare enough to fail open on.
    cmd = "\n".join(re.sub(r"(^|[ \t])#.*$", r"\1", ln) for ln in cmd.split("\n"))

    for seg, sep in split_with_seps(cmd):
        target = file_view_target(seg, sep)
        if target:
            prog = shlex.split(seg.strip())[0]
            sys.stderr.write(
                f"BLOCKED: view files with the Read tool, not Bash `{prog}` (target: {target}).\n"
                "Bash file-viewing doesn't register a tracked read — it breaks a later Edit/Write "
                "and violates the project's Read-tool rule.\n"
                "Allowed: `tail -f` (log follow), piping a viewer into another command "
                "(`cat f | jq`), redirects/heredocs, and `sed -i` edits.\n"
            )
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
