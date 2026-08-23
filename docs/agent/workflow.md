# How a change gets made here

The executable version is `/flow`. This is what it does and why.

## One command, not four

An earlier version of this process was a chain: analyse, then implement, then check drift, then write
up. Four commands, four places to keep in step, and three of them useless on their own — nobody has
ever wanted to run "the write-up phase".

They are one command with phases. The phases are still real; they just do not need to be typed.

## The phases

**1. Understand.** Read what exists before proposing anything. The single most expensive habit here
is inferring a cause from a symptom and shipping it: the fix that *sounds* right gets written, merged
and deployed, and the real payload says something else. Pull the real thing — the config, the API
response, the frame, the file — first.

**2. Record the before.** `EVIDENCE=before npx witness action run <action>`. Before the change,
because after it there is nothing left to record. If no existing action shows the behaviour, write
one — that is not overhead, it is the deliverable that outlives the ticket.

**3. Change it.** Smallest diff that actually fixes the cause. If the symptom shows up in one caller
but the bug is in the shared function, fix the shared function.

**4. Record the after.** `EVIDENCE=after npx witness action run <same action>`. Same action, same
viewport, same journey — a before and after that differ in two ways prove nothing about either.

**5. Read what you recorded.** Open the frames. Every claim a caption makes has to be visible in the
frame it captions. This is where green runs get caught producing evidence that contradicts the
sentence written over them. A terminal recording has no `frames/` — its still is `video.png` beside
the video, the last frame, because that is where a shell's output is.

**6. Check.** `npm run check` — types, lint, unused, tests. And `npx witness check drift` if the
change touched anything a description claims.

**7. Raise it.** Branch, commit, PR. The body carries the before and the after. Watch the checks by
their **exit code**, not by eyeballing the tail of the output.

**8. Learn.** If the run taught something that would have saved an hour, append it to
[knowledge.md](knowledge.md). One entry, with the *why*. Nothing else in the repository gets updated
with process notes.

## What is enforced, not trusted

Two hooks in `.claude/hooks/`, because both of these were prose rules that got broken anyway:

- **`require-evidence.sh`** — an image cannot be surfaced, uploaded or cited in a published body
  unless it was Read back *after* it was last captured. `witness action run` overwrites the whole run
  directory, so re-running invalidates every earlier read of it. A screenshot you never opened is not
  evidence, and neither is one you opened before re-shooting it.
- **`require-before-after.sh`** — a pull request that changes behaviour must have both an
  `EVIDENCE=before` and an `EVIDENCE=after` run in the session. Docs-only changes are exempt, and
  `[no-evidence: <reason>]` in the body is a deliberate, reviewable override.

Two things stay discipline rules because no hook can check them: whether a frame supports the
**claim** (phase 5), and whether the `after` was recorded **after** the change. The second was
enforced for one afternoon — deciding "was that command an edit?" from a transcript needs a
heuristic, and the heuristic fired on a `grep` and then on the hook editing itself. Narrowing it to
the Edit tool would have made it inert here, where most editing is a heredoc, and an inert gate that
looks active is the worse failure.
