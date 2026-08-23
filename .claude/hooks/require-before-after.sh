#!/usr/bin/env bash
# require-before-after.sh — PreToolUse gate. A pull request that changes behaviour carries a
# recording of the behaviour, before and after.
#
# This is a terminal tool that records terminal and browser sessions. "Show, don't assert" is its
# whole premise, so a pull request from it that says "fixed" and shows nothing is the one thing it
# cannot ship. The rule was prose first; prose lost.
#
# Blocks `gh pr create` / `gh pr edit --body…` unless, in THIS session, both an
# `EVIDENCE=before … witness action run …` and an `EVIDENCE=after … witness action run …` ran.
#
# EXEMPT: a diff that touches only docs, markdown and the agent files. There is nothing to record,
# and demanding a video of a typo fix is how a gate gets disabled.
#
# NOT checked, and deliberately not attempted:
#   - whether the two recordings show the same journey
#   - whether the after shows the fix
#   - whether the after was recorded AFTER the last edit
# The third was tried. Deciding "was that command an edit?" from a transcript needs a heuristic, and
# the heuristic fired on `grep foo bar.sh` and on editing this hook — twice, on its own first run.
# Narrowing it to the Edit tool would have made it inert here, where most editing is a heredoc, and
# an inert gate that looks active is worse than no gate. It is a discipline rule in /flow instead,
# beside the one no hook can check: does the frame support the claim.
#
# Override, for the case the rule genuinely does not fit: put `[no-evidence: <reason>]` in the PR
# body. Deliberate, visible in the diff, and reviewable — unlike deleting the hook.
set -uo pipefail
input=$(cat)
get() { jq -r "$1 // \"\"" <<<"$input" 2>/dev/null; }
tool=$(get '.tool_name'); tx=$(get '.transcript_path'); cwd=$(get '.cwd'); [ -n "$cwd" ] || cwd="."
[ "$tool" = "Bash" ] || exit 0
[ -n "$tx" ] && [ -f "$tx" ] || exit 0

cmd=$(get '.tool_input.command')
case "$cmd" in *gh*pr*create*|*gh*pr*edit*) ;; *) exit 0 ;; esac
# `gh pr edit --add-label`, `--milestone` and friends change no prose. Only a body edit is a claim.
case "$cmd" in *gh*pr*edit*) case "$cmd" in *--body*) ;; *) exit 0 ;; esac ;; esac

deny() { jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'; exit 0; }

# The escape hatch, read from the body being published — file or inline.
bf=$(printf '%s' "$cmd" | sed -n 's/.*--body-file[= ][[:space:]]*\([^[:space:]]*\).*/\1/p' | head -1)
if [ -n "$bf" ]; then
  bf=$(printf '%s' "$bf" | tr -d "\"'"); case "$bf" in /*) : ;; *) bf="$cwd/$bf" ;; esac
  [ -f "$bf" ] && grep -qF '[no-evidence:' "$bf" && exit 0
else
  case "$cmd" in *'[no-evidence:'*) exit 0 ;; esac
fi

# Docs-only? Compare against the default branch's merge base, not the working tree: the commits are
# already made by the time a PR is raised.
base=$(git -C "$cwd" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || echo "origin/master")
changed=$(git -C "$cwd" diff --name-only "$base"...HEAD 2>/dev/null)
[ -n "$changed" ] || exit 0   # nothing to compare against — say nothing rather than block blind
code=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    docs/*|*.md|.claude/*|LICENSE|.gitignore) continue ;;
    *) code=1 ;;
  esac
done <<<"$changed"
[ -n "$code" ] || exit 0

command -v python3 >/dev/null 2>&1 || exit 0   # cannot verify; do not deny on a false reason

# Did both cuts get recorded in this session? Counted from the transcript's own tool calls, so it is
# what actually ran rather than what a summary says ran.
counts=$(python3 - "$tx" <<'PY' 2>/dev/null
import json, sys

before = after = 0
try:
    with open(sys.argv[1], "r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except Exception:
                continue
            content = (entry.get("message") or {}).get("content")
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict) or block.get("type") != "tool_use":
                    continue
                if (block.get("name") or "") != "Bash":
                    continue
                c = str((block.get("input") or {}).get("command") or "")
                if "action run" not in c or "witness" not in c:
                    continue
                if "EVIDENCE=before" in c:
                    before += 1
                elif "EVIDENCE=after" in c:
                    after += 1
except Exception:
    pass
print(before, after)
PY
)
read -r before after <<<"$counts"
before=${before:-0}; after=${after:-0}

missing=""
[ "$before" = "0" ] && missing="${missing}  - no \`EVIDENCE=before … witness action run …\` in this session"$'\n'
[ "$after" = "0" ] && missing="${missing}  - no \`EVIDENCE=after … witness action run …\` in this session"$'\n'
[ -n "$missing" ] || exit 0

deny "Before/after gate: this pull request changes code, so it needs a recording of the behaviour on both sides of the change. This tool's whole premise is that a green tick is not the deliverable; a PR from it that asserts a fix and shows nothing is the one thing it cannot ship.
${missing}
Do this:
  EVIDENCE=before npx witness action run <action>   # BEFORE the change — afterwards there is nothing left to record
  …make the change…
  EVIDENCE=after  npx witness action run <action>   # same action, same inputs
Both cuts land side by side under .witness/artifacts/cli/<action>/. Open the frames, then cite them in the body.
Record the after AFTER the change — this cannot check that, and a stale after looks like evidence without being any.
No action shows it? Write one — docs/how-to/write-an-action.md. It outlives this PR.
Terminal output rather than a screen? docs/how-to/record-a-terminal.md.
Genuinely nothing to record? Put [no-evidence: <reason>] in the body — visible in the diff and reviewable."
