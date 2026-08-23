#!/usr/bin/env bash
# require-evidence.sh — PreToolUse gate. An image you never looked at is not evidence.
#
# Before you SURFACE an image (SendUserFile), UPLOAD one (a browser file-upload tool), or PUBLISH a
# body that cites one (`gh pr create`, `gh pr edit`, `gh issue comment`, `gh api -F body=@…`), that
# exact image must have been Read back THIS session, AFTER it was last captured.
#
# Why it has to be a hook rather than a rule: `witness action run` writes PNGs to disk and returns
# JSON. The model never sees the pixels. Claiming a frame "shows the fix" without opening it is
# narrating intent, not evidence — and this project has shipped a caption that contradicted its own
# frame twice.
#
# Three rules, all mechanical:
#   1. READ-BACK     every image surfaced/uploaded/cited was Read this session.
#   2. RECENCY       that Read came AFTER the last capture of it. `witness action run` OVERWRITES
#                    its whole run directory (same run, same paths, by design), so a re-run
#                    invalidates every earlier Read of every frame beneath it — which is exactly the
#                    before/after case this workflow is built around.
#   3. NO-LOCAL-REFS a published body must not cite a local image path. `gh` cannot reach GitHub's
#                    user-attachments CDN, so it renders NOTHING and the evidence silently vanishes.
#
# NOT checked, and deliberately not attempted: whether the frame supports the CLAIM. No hook can diff
# prose against pixels. That stays phase 5 of /flow.
#
# Video (mp4/gif/webm) is ignored here: it is validated by extracting frames and Reading those.
set -uo pipefail
input=$(cat)
get() { jq -r "$1 // \"\"" <<<"$input" 2>/dev/null; }
tool=$(get '.tool_name'); tx=$(get '.transcript_path'); cwd=$(get '.cwd'); [ -n "$cwd" ] || cwd="."
[ -n "$tx" ] && [ -f "$tx" ] || exit 0

deny() { jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'; exit 0; }

is_img() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in *.png|*.jpg|*.jpeg|*.webp) return 0 ;; *) return 1 ;; esac
}

# Image REFERENCES in a body: markdown ![](…) and <img src="…"> only. Matching any filename-shaped
# substring would deny every body that merely MENTIONS an artifact path in prose, which these do
# constantly. Buffered first — two greps on one stdin leave the second empty.
image_refs() {
  local text
  if [ "$#" -gt 0 ]; then text=$(cat "$1" 2>/dev/null); else text=$(cat); fi
  {
    printf '%s\n' "$text" | grep -oE '!\[[^]]*\]\([^)]+\)' | sed -E 's/^!\[[^]]*\]\(//; s/\)$//'
    printf '%s\n' "$text" | grep -oE "<img[^>]+src=[\"'][^\"']+" | sed -E "s/.*src=[\"']//"
  } | sed -E 's/[[:space:]].*$//' | sort -u
}

candidates=""; published_body=""
case "$tool" in
  SendUserFile) candidates=$(jq -rc '.tool_input.files[]? // empty' <<<"$input" 2>/dev/null) ;;
  *upload_file|*file_upload|*upload_image)
    candidates=$(get '.tool_input.filePath'); [ -n "$candidates" ] || candidates=$(get '.tool_input.file_path') ;;
  Bash)
    cmd=$(get '.tool_input.command')
    case "$cmd" in
      *gh*pr*create*|*gh*pr*edit*|*gh*issue*comment*|*gh*api*body=@*|*--body-file*) ;;
      *) exit 0 ;;
    esac
    # `--body-file <f>`, `--body-file=<f>`, `-F body=@<f>`. The `[= ]` alternative is load-bearing:
    # matching only the space form captured "=body.md", failed the -f test, and let the publish
    # through — a one-character bypass of the gate.
    bf=$(printf '%s' "$cmd" | sed -n 's/.*--body-file[= ][[:space:]]*\([^[:space:]]*\).*/\1/p' | head -1)
    [ -n "$bf" ] || bf=$(printf '%s' "$cmd" | sed -n 's/.*body=@\([^[:space:]]*\).*/\1/p' | head -1)
    if [ -n "$bf" ]; then
      bf=$(printf '%s' "$bf" | tr -d "\"'"); case "$bf" in /*) : ;; *) bf="$cwd/$bf" ;; esac
      # A body file we cannot open is not a pass, but it is also not a violation — say nothing rather
      # than deny on a path this parse mangled (a quoted path with a space).
      [ -f "$bf" ] || exit 0
      published_body="$bf"; candidates=$(image_refs "$bf")
    else
      # Inline `--body '…'` publishes exactly as hard as a file does.
      published_body="(inline)"; candidates=$(printf '%s' "$cmd" | image_refs)
    fi ;;
  *) exit 0 ;;
esac
[ -n "$candidates" ] || exit 0

has_img=""
while IFS= read -r p; do [ -n "$p" ] && is_img "$p" && has_img=1; done <<<"$candidates"
[ -n "$has_img" ] || exit 0

# RULE 3 — a published body must not cite a local image path.
if [ -n "$published_body" ]; then
  locals=""
  while IFS= read -r p; do
    [ -n "$p" ] || continue; is_img "$p" || continue
    case "$p" in *user-attachments/assets/*|http://*|https://*) continue ;; esac
    locals="${locals}  - ${p}"$'\n'
  done <<<"$candidates"
  [ -n "$locals" ] && deny "Evidence gate: the body you are publishing cites LOCAL image path(s). \`gh\` cannot reach GitHub's user-attachments CDN, so these render NOTHING — the evidence silently vanishes and the comment reads as if it had none. Upload each image through a logged-in browser to mint a \`user-attachments/assets/…\` URL, put THAT in the body, then publish.
Local image reference(s):
${locals}"
  exit 0
fi

# RULES 1+2 — read back, and after the last capture.
command -v python3 >/dev/null 2>&1 || deny "Evidence gate: python3 is required to walk the transcript, and read-back cannot be verified without it. Install python3, or confirm by hand that each image was Read after its last capture and run this step yourself."

positions=$(python3 - "$tx" <<'PY' 2>/dev/null
import json, os, re, sys

IMG = (".png", ".jpg", ".jpeg", ".webp")
cap, red, runs = {}, {}, []
# Position counts TOOL_USE BLOCKS, not transcript lines: a Read and a re-capture batched into one
# assistant message share a line, which made them compare equal and let a stale frame pass.
i = 0
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
                i += 1
                name = block.get("name") or ""
                inp = block.get("input") or {}
                # A `witness action run` REWRITES its whole run directory, so it is a capture event
                # for every frame under artifacts — not for one named file. Recorded as a bare
                # position; any frame Read before it is stale.
                if name == "Bash":
                    c = str(inp.get("command") or "")
                    if "action run" in c and "witness" in c:
                        # Which CUT it overwrote. A run rewrites `<actions>/<cut>/` and nothing else,
                        # so an `EVIDENCE=after` run leaves every `before/` frame exactly as it was —
                        # which is the whole before-change-after workflow. Invalidating those was a
                        # false positive on the one sequence this gate exists to support.
                        m = re.search(r"EVIDENCE=(\w+)", c)
                        runs.append((m.group(1) if m else "run", i))
                    continue
                path = inp.get("file_path") or inp.get("filePath") or ""
                if not isinstance(path, str) or not path.lower().endswith(IMG):
                    continue
                base = os.path.basename(path)
                if name == "Read":
                    red[base] = i
                elif "screenshot" in name.lower():
                    cap[base] = i
except Exception:
    pass

# One line per cut: the last run that rewrote it.
for cut in dict(runs):
    print("RUN\t%s\t%d" % (cut, max(i for c, i in runs if c == cut)))
for base in set(list(cap) + list(red)):
    print("%s\t%d\t%d" % (base, cap.get(base, -1), red.get(base, -1)))
PY
)

# The last run that rewrote a given cut. A frame is only stale if ITS cut was re-recorded.
last_run_of() { printf '%s\n' "$positions" | awk -F'\t' -v c="$1" '$1=="RUN" && $2==c {print $3; f=1} END {if (!f) print "-1"}' | head -1; }
lookup() { printf '%s\n' "$positions" | awk -F'\t' -v b="$1" -v c="$2" '$1==b {print $c; found=1} END {if (!found) print "-1"}' | head -1; }

unvalidated=""; stale=""
while IFS= read -r p; do
  [ -n "$p" ] || continue; is_img "$p" || continue
  b=$(basename "$p")
  cap_i=$(lookup "$b" 2); red_i=$(lookup "$b" 3)
  # A frame under `<actions>/<cut>/` is invalidated by the last run of THAT cut; anything else only
  # by a capture of its own name.
  cut=$(printf '%s' "$p" | sed -n 's#.*/artifacts/[^/]*/[^/]*/\([^/]*\)/.*#\1#p')
  if [ -n "$cut" ]; then
    lr=$(last_run_of "$cut")
    [ "$lr" != "-1" ] && [ "$lr" -gt "$cap_i" ] 2>/dev/null && cap_i="$lr"
  fi
  if [ "$red_i" = "-1" ]; then
    unvalidated="${unvalidated}  - ${p}"$'\n'
  elif [ "$cap_i" != "-1" ] && [ "$red_i" -lt "$cap_i" ]; then
    stale="${stale}  - ${p} (read back, then RE-RECORDED — the pixels changed since you looked)"$'\n'
  fi
done <<<"$candidates"

if [ -n "$unvalidated" ] || [ -n "$stale" ]; then
  reason="Evidence gate: you are about to surface or upload frame(s) you have not looked at in their CURRENT form, so you cannot know they show what you are about to say they show. \`witness action run\` writes the PNGs and hands you JSON — you are blind to the pixels. Read each file below (a Read on an image returns it visually), say what it ACTUALLY shows, then retry.
A frame you never opened is not evidence, and neither is one you opened before re-running.
While you are there: is every thing your caption names actually visible in the frame?"
  [ -n "$unvalidated" ] && reason="${reason}
Never read back:
${unvalidated}"
  [ -n "$stale" ] && reason="${reason}
Read back BEFORE the latest run (stale):
${stale}"
  deny "$reason"
fi
exit 0
