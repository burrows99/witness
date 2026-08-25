# Raising a PR with evidence

How an agent goes from "I changed code" to "a PR a reviewer can watch".

Every step is a shell command. `--json` on every call: the agent reads JSON, never prose.

---

## 0. Once per project

```bash
witness init --agents        # .witness/config.json + AGENTS.md block
witness skill                # .claude/skills/verify-<project>/SKILL.md
witness doctor --json        # which languages this machine can instrument
```

Read `doctor` before anything else. If the language you changed has no adapter, the gate
will not cover it and the PR should say so rather than imply coverage.

---

## 1. Write down what the change proves

```bash
witness plan \
  --intent "deleting a firing rule sends its resolved notification" \
  --scope 'pkg/services/ngalert/**' \
  --json
```

Edit the emitted plan: add the `fixture` that brings the app up, the `steps` that drive it,
and at least one `assertion`. **Commit the plan with the change** — a reviewer reads what you
set out to prove before they look at whether it went green.

A plan with no assertions earns `SV021`: it proves the code ran, not that it behaved.

---

## 2. Prove it, and film it

```bash
witness verify --plan <plan-id> --record --json
```

One command: instruments every changed line, brings the fixture up, drives the plan, evaluates
the gate. `--record` adds a captioned MP4 to `story.artifacts`.

Read the exit code:

| Exit | Meaning | Next move |
|---|---|---|
| `0` | allow | go to step 3 |
| `2` | block | act on each finding's `remedy` — never weaken the plan |
| `3` | usage/config | fix the plan or config |
| `4` | harness failure | witness could not observe; run `doctor`, report it |
| `5` | bypassed | recorded and amber, not green |

---

## 3. Film the reproduction too

A recording of the working state proves nothing on its own — a reader cannot tell a fix from a
film of a healthy system. What convinces is the pair.

```bash
git stash                                        # or: git checkout <base>
witness run --plan <plan-id> --record --json  # the bug, reproduced
git stash pop
```

The tool does not orchestrate this: which recording you get is decided by **what is checked
out**. Each file names its own branch and commit, and is marked `-dirty` when the tree had
uncommitted changes — a recording that cannot be reproduced from its commit says so.

> A reproduction must not end on the working state. The same plan runs against both builds, so
> a reconciling final beat makes the pair indistinguishable at the frame a reviewer scrubs to.

---

## 4. Collect the artefacts

```bash
witness show --run <run-id> --json     # self-contained viewer.html
```

Everything for the run is under `.witness/runs/<run-id>/`:

```
story.json                  the sealed evidence
artifacts/video/run.mp4     the recording        readableBy: [human]
artifacts/a11y/*.yaml       what the agent reads readableBy: [agent]
logs/harness.log            what the harness did
viewer.html                 30-second audit, offline
```

---

## 5. Open the PR

```bash
gh pr create --base main --head <branch> --title "<title>" --body-file body.md
```

Write the body with a placeholder per recording (`BEFORE_VIDEO`, `AFTER_VIDEO`). State what the
evidence shows — and, if the pair shows no difference, say that instead of implying one.

---

## 6. Attach the recordings — needs a logged-in browser

**`gh` and a PAT cannot reach GitHub's `user-attachments` CDN.** A body referencing a local path
renders nothing. The only way to mint an inline video URL is GitHub's own web editor.

1. Open the PR in a browser already signed in to GitHub.
   Confirm: `document.querySelector('meta[name="user-login"]')?.content`
2. Upload each file into the **"Paste, drop, or click to add files"** control on the comment box.
3. Wait for the box to fill with `https://github.com/user-attachments/assets/…`, one per file.
4. **Clear the box** so no stray comment posts.
5. Substitute the URLs into the body and publish with `gh`:

```bash
gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -F body=@body.md
```

A bare attachment URL on its own line becomes an inline `<video>` player.

---

## 7. Verify the evidence rendered

```js
[...document.querySelectorAll('video')].map(v => ({ readyState: v.readyState, duration: v.duration }))
```

`readyState === 4` and a non-zero duration. A dead link is not evidence — if it did not render,
fix it and re-upload.

---

## The rules that make this evidence

Each one comes from a recording that misled somebody.

- **A run that records nothing fails.** A green result with no video is the failure recording exists to prevent.
- **A caption narrates what the frame renders.** A value that was measured and which the app does not draw belongs in the probe dock, which says `MEASURED` on its face.
- **Narration is never typed into the app or the shell.** Title cards are spliced in; the terminal shows commands and their output, nothing else.
- **Never weaken a plan to turn the gate green.** Narrowing scope, deleting assertions and waiving lines are the only tools that make a pass mean anything.
- **Do not bank a vacuous claim.** If the precondition was absent, or the pair shows no difference, say so on screen and in the PR.

---

## What the CLI does not do yet

Stated plainly, because a playbook that overstates its tooling wastes the reader's time.

| Step | Today |
|---|---|
| Attaching video to a PR (step 6) | Manual browser. No CLI path exists — the CDN is unreachable from `gh`. |
| Bringing up a containerised app | `fixture.kind: "compose"` exits 3. Only `process` and `none` work, so an app needing provisioning is driven by a script. |
| Terminal recordings | Produced by `@macquery-labs/recorders` as a library, not yet a registered `Recorder`, and not attached to the story. |
| TypeScript / Java coverage | No vendored adapter — `doctor` reports it, and the gate reports `SV016` rather than pretending. |
