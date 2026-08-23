# What a run leaves behind

```
.witness/artifacts/cli/<the actions you ran>/<cut>/
  README.md                     what is where, and the call tree
  video.mp4                     the whole session, watchable
  frames/01-her-dashboard.png   the stills a `frame` step asked for, in order
  manual-verification.md        how to re-walk it by hand
  <action>/NN-<verb>.png        a frame per step, numbered as they happened
  <action>/debug.md | .json     what happened, network and console tied to each step
  <action>/NN-run/<composed>/   an action a step composed, filed inside that step
```

Nothing is named by hand. The path comes from facts that are already unique: how the run was driven,
what was run, which cut. Same run, same paths — so a re-run **overwrites** rather than accumulating.

- **`<cut>`** is `before`, `after` or `run`. `EVIDENCE=before npx witness action run …` records the
  behaviour as it is; make the change; `EVIDENCE=after …` files the second cut beside the first.
- **One browser session → one video and one `frames/`**, at the top. A directory below with no video
  of its own is not missing one; it is part of the same recording.
- **`--parallel`** adds `panel-<lane>-<attempt>.webm|.mp4`, and names each lane's directory for its
  pane, so two lanes running the same action do not overwrite each other.
- **`--retries=N`** keeps each attempt: `<action>-retry-2/`.
- Playwright's own `trace.zip` is kept too — `npx playwright show-trace …` for a person.

## The directory tree is the call tree

An action a step composed sits **inside that step**, named for it. Playwright puts every artefact in
one flat opaque directory and moves the structure into the trace viewer, which is right when a
person is reading and useless when a program is. Here, `ls` answers "what ran what".
See [explanation/the-directory-is-the-tree.md](../explanation/the-directory-is-the-tree.md).

## Redaction

Recorded request bodies are redacted **by field name** — `password`, `token`, `secret`, `apiKey`,
`authorization`, `credential` and friends, in JSON and form-encoded bodies. A debug story is written
to be pasted into a pull request, which is exactly how one becomes the place a password is published.
By name rather than by value, because the harness cannot know which strings are secret.

`KEEP=1` keeps the intermediate recordings that would otherwise be cleaned up.
