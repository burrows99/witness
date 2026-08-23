# diagnostics

`src/diagnostics/` — what happened, and whether the description still describes it.

| file | |
|---|---|
| `trace.ts` (74) | every request, statement and step the *harness* made |
| `inspector.ts` (221) | DevTools as data — the *browser's* network, console, exceptions |
| `story.ts` (358) | all of it, told once, in the order a person wants it |
| `drift.ts` (292) | verify the claims the description makes, without running it |

## inspector

The one thing DevTools cannot give you afterwards is **which step each entry belongs to**. "A 500
came back" is not a diagnosis; "the 500 came back during `click Cancel order`, and the console error
one tick later says the reducer got undefined" is — and reconstructing that by hand across three
panes is the work this exists to stop repeating.

Bodies are read only for what is worth reading: anything that failed, and anything small and textual.
`text/css` and `text/javascript` both contain "text", which is how 109KB of Bootstrap once ended up
in the middle of a debug story.

**Redaction is by field name**, in `Inspector.redact`. A debug story is written to be pasted into a
pull request, which is precisely how one becomes the place a password is published. By name rather
than by value because the harness cannot know which strings are secret — in this repo's own stack the
password *is* the username.

## story

Playwright's trace is a better debugger than anything hand-written, and none of it is reimplemented:
the story **names the trace path** and adds the join the trace does not have — the step list, the
failure, and the network and console grouped under the step that was running.

## drift

Claims-based on purpose. An earlier version swept every locator across every route and reported
**eight findings against a description that was correct**: a `store` matching 226 elements (its whole
point), one matching on a route no step uses it on, one matching nothing because it only exists after
a click. A checker that cries wolf is worse than none. The rules it settled on are in
[how-to/check-for-drift.md](../how-to/check-for-drift.md).

The same reasoning skips a `records: "terminal"` action rather than driving a browser at it — and
**counts** what it skipped into the summary, because a report that quietly read half a description
and answered "all claims still hold" is the same lie from the other end.
