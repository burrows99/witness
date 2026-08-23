---
description: Make a change here end to end — understand, record before, change, record after, check, raise, learn.
argument-hint: <what to change, or an issue number>
---

# /flow — $ARGUMENTS

One command. The phases below are not separate commands to invoke; run them in order yourself.

Read `docs/agent/knowledge.md` **now**, before phase 1. It is short and it is the accumulated cost of
getting these things wrong.

The command here is `./bin/witness`, not `npx witness`. npm does not link a package's own `bin` into
its own `node_modules/.bin`, so in this checkout `npx witness` misses and goes to the registry looking
for an unrelated package — which is worse than failing. `npx witness` is right for a project that
DEPENDS on this one, and it is what `docs/reference/`, `docs/how-to/` and the README are written for.

---

## 1 · Understand

Read what exists before proposing anything.

- What does the request actually say? Restate it in one sentence. If two readings lead to materially
  different work, ask — otherwise pick the one a careful colleague would and say which.
- Find the code. `docs/internals/README.md` maps `src/` to its eleven areas.
- **Pull the real thing.** The config, the API response, the artifact tree, the frame. Not a
  screenshot of it, not an inference from the symptom. The most expensive habit in this repository's
  history is a plausible cause written up before anyone looked.
- Is the bug where the symptom is, or in something all the callers share? Grep the callers before
  editing one.

Say what you found and what you are going to change, in a few lines. Then continue — do not stop for
approval unless the answer changes what gets built.

## 2 · Record the before

Before touching anything, because afterwards there is nothing left to record.

```bash
EVIDENCE=before ./bin/witness action run <action>
```

- No action shows the behaviour? Write one. `docs/how-to/write-an-action.md`. It outlives the ticket.
- The change is in terminal output rather than a screen? The service records with
  `"records": "terminal"` — `docs/how-to/record-a-terminal.md`. This is a terminal tool; most of its
  own evidence is a terminal.
- Genuinely nothing observable (a refactor, docs, types)? Say so explicitly and skip to 3. The
  before/after gate exempts docs-only diffs and nothing else, so if you skip here you will have to
  justify it at phase 7.

## 3 · Change it

Smallest diff that fixes the **cause**. Match the surrounding code's idiom, naming and comment
density. Two constraints that are not negotiable here:

- **zero runtime dependencies** — Playwright is an optional peer, ffmpeg and VHS are optional
  binaries; missing means a warning, never a failure
- **explicit `.ts` on every relative import**

If something in `docs/` is now wrong, fix it in the same diff. A stale path in `src/skill/skill.ts`
is a defect, not a doc nit: it is the only thing an agent reads.

## 4 · Record the after

```bash
EVIDENCE=after ./bin/witness action run <same action>
```

Same action, same inputs, and everything you did not change held still — a before and an after that
differ in two ways prove nothing about either.

The exception is when the geometry **is** the change: a viewport, a terminal pane. Holding those still
would hide the very thing being fixed, so vary that one, hold the rest, and say in the body which one
moved. "Same viewport" is the rule for a change that is not about the viewport.

## 5 · Look at what you recorded

**Open the frames.** Read them — a Read on an image returns the pixels; the run does not.

A terminal recording has no `frames/`; its still is `video.png`, beside the video, and it is the
**last** frame — where a shell's output is. If it shows the tail of something longer than the pane,
the pane is what to change: `"pane": { "height": …, "fontSize": … }`, not a `head -N` in the step.

For each one you are going to show anybody: does the frame contain the thing your caption claims?
Twice in this project's history a green run produced evidence that contradicted the sentence written
over it. No hook can check this; it is the one rule that stays yours.

If the after does not show the fix, the fix is not done. Go back to 3.

## 6 · Check

```bash
npm run check                    # types, lint, unused, tests
./bin/witness check drift <action> # if the change touched anything a description claims
```

Read the **exit code**. Do not pipe to `tail`, `head` or `grep` and judge by what you see — a pipeline
reports the exit code of its *last* command, which is the one you added, and that has hidden a failure
here more than once. Output too long to sit in front of you? Redirect it and read the file afterwards,
so the code you read still belongs to the command you ran:

```bash
npm run check > /tmp/check.log 2>&1; echo "exit=$?"
grep -n "error" /tmp/check.log
```

This file used to say to capture the shell's `PIPESTATUS` array instead. It is the textbook answer and
it was the wrong one here: agent harnesses refuse to run a command containing a `${…[0]}` subscript, so
the repository's headline verification idiom was one three agents could not type. Not piping needs no
array.

## 7 · Raise it

```bash
git switch -c <kind>/<short-name>
git add -A && git commit
gh pr create --title "<what changed, as a sentence>" --body-file <file>
```

- **The title says what changed**, in the repository's voice — a sentence, not a ticket number.
- **The body carries the before and the after.** `gh` cannot upload an image, so a local path in the
  body renders nothing; mint real attachment URLs through a logged-in browser and cite those.
  `require-evidence.sh` blocks a body that cites a **local** image path — but it only ever looks at a
  body that cites an image at all, so a body citing none publishes cleanly. Nothing stops a pull
  request that shows nothing. That one is yours.
- **The upload goes through the browser too, and a browser upload tool does not take any path you can
  read.** It accepts what the session was started on — the project directory — and refuses the rest,
  so a frame under `/tmp`, or in the worktree you are working in beside the project, is rejected
  however correct the path is. Copy it into the project first, Read the copy (`require-evidence.sh`
  will have you do that anyway, and it will happily approve a path the uploader then refuses), and
  upload the copy.
- **Both cuts must exist**, or `require-before-after.sh` blocks it. Nothing checks that the after came
  after the change — that one is on you, and a stale after looks like evidence without being any.
- Then prove the checks ran, which is not the same as watching them:
  ```bash
  .claude/pr-green.sh <n>; echo "exit=$?"
  ```
  `gh pr checks <n> --watch` on its own cannot tell you a pull request is green. It reports on the
  checks that **exist**, and for a minute or two after a push ours do not — so it watches whichever
  third-party app answered first, finds nothing pending and nothing red, and exits `0`. On a pull
  request GitHub calls `CONFLICTING` it is worse: `check` and `analyze` are never queued at all, and
  that `0` is permanent. `pr-green.sh` asks for those two by name, waits for them to be created, and
  only then watches.
- Merge only when that is `0`. **A green exit on an empty check set is not a green pull request.**

## 8 · Learn

Did this run cost you an hour you could hand to the next person? Append one entry to
`docs/agent/knowledge.md`: the trap, and **why** it is a trap. In the right section, newest at the
bottom.

Nothing else in the repository gets updated with process notes. If the *process* changed rather than
the knowledge, edit `docs/agent/workflow.md` and this file together — they are supposed to agree.

If nothing was learned, say so and skip it. A file padded with entries nobody needed is how it stops
being read.
