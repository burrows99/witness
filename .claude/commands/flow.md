---
description: Make a change here end to end — understand, record before, change, record after, check, raise, learn.
argument-hint: <what to change, or an issue number>
---

# /flow — $ARGUMENTS

One command. The phases below are not separate commands to invoke; run them in order yourself.

Read `docs/agent/knowledge.md` **now**, before phase 1. It is short and it is the accumulated cost of
getting these things wrong.

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
EVIDENCE=before npx witness action run <action>
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
EVIDENCE=after npx witness action run <same action>
```

Same action, same inputs, same viewport. A before and an after that differ in two ways prove nothing
about either.

## 5 · Look at what you recorded

**Open the frames.** Read them — a Read on an image returns the pixels; the run does not.

For each one you are going to show anybody: does the frame contain the thing your caption claims?
Twice in this project's history a green run produced evidence that contradicted the sentence written
over it. No hook can check this; it is the one rule that stays yours.

If the after does not show the fix, the fix is not done. Go back to 3.

## 6 · Check

```bash
npm run check                    # types, lint, unused, tests
npx witness check drift <action> # if the change touched anything a description claims
```

Read the **exit code**. Do not pipe to `tail`, `head` or `grep` and judge by what you see — that has
hidden a failure here more than once. If you must pipe, check `${PIPESTATUS[0]}`.

## 7 · Raise it

```bash
git switch -c <kind>/<short-name>
git add -A && git commit
gh pr create --title "<what changed, as a sentence>" --body-file <file>
```

- **The title says what changed**, in the repository's voice — a sentence, not a ticket number.
- **The body carries the before and the after.** `gh` cannot upload an image, so a local path in the
  body renders nothing; mint real attachment URLs through a logged-in browser and cite those.
  `require-evidence.sh` will block the publish otherwise, and it is right to.
- Then watch the checks **by exit code**:
  ```bash
  gh pr checks <n> --watch; echo "exit=$?"
  ```
- Merge only when that is `0`.

## 8 · Learn

Did this run cost you an hour you could hand to the next person? Append one entry to
`docs/agent/knowledge.md`: the trap, and **why** it is a trap. In the right section, newest at the
bottom.

Nothing else in the repository gets updated with process notes. If the *process* changed rather than
the knowledge, edit `docs/agent/workflow.md` and this file together — they are supposed to agree.

If nothing was learned, say so and skip it. A file padded with entries nobody needed is how it stops
being read.
