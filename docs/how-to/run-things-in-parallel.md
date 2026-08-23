# Run things in parallel

```bash
npx witness action run theApp theOutsider theMail theWatcher --parallel
```

Every named action at once, each in its own browser, stitched into **panels of one frame** — two or
three side by side, four or more in a grid.

## What it costs

- **Lanes cannot pass values to each other.** Each gets the inputs the caller passed and nothing else.
- **Each lane is a fresh, signed-out browser.** Anything needing a session must sign itself in
  (`{ "run": "signIn" }` as its first step). Three panes all showing a login screen is the usual first
  result, and it is the semantics being honest.
- **A lane that depends on another's side effect is racing.** Sometimes that is the point — have the
  others *look again* (`goto`, wait, `goto`) so a pane shows the repository **arriving** rather than a
  still of it.

## Naming the panes

The opening `slide` is spliced once, full-frame, rather than painted into all four — so put the legend
there:

```jsonc
{ "slide": { "title": "Four services, at once", "lines": [
  "top left — the app: somebody registers and makes a repository",
  "top right — what a stranger sees of it, signed out",
  …
] } }
```

Each pane also carries a header from its action's own `summary`. A lane's evidence directory is named
for its pane — `01-theapp` beside `panel-01` — so two lanes running the same action do not write over
each other.

## Retries

```bash
npx witness action run flaky --retries=2
```

A fresh browser each go. The failed attempt keeps its own directory (`<action>-retry-2/`) — the
failure is the interesting one, and a retry that quietly overwrote it would leave a green run with
nothing to explain it.

## When not to

A chain is one story and should stay one continuous recording. `action run signIn checkout` shares one
browser on purpose; `--parallel` would sign in twice and check out signed-out.
