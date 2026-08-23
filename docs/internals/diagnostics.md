# diagnostics

`src/diagnostics/` — what happened, and whether the description still describes it.

| file | |
|---|---|
| `trace.ts` (74) | every request, statement and step the *harness* made |
| `inspector.ts` (221) | DevTools as data — the *browser's* network, console, exceptions |
| `story.ts` (502) | all of it, told once, in the order a person wants it |
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

**What counts as a failure was the transport, and the transport is not the question** (#145). One
predicate — `!!request.failure || (request.status ?? 0) >= 400` — made a graph build that had 401'd
against its provider the whole way through render as three ticks, a clean console and `ok` in the
title, with the traceback sitting in `debug.json` two files away: captured, stored, and not looked at.
It is the shape of most Python and PHP APIs, of every job whose failure arrives by polling, and of
GraphQL *by specification* — so for one of the wire formats this ships a provider for, the network
table could never show a failure at all. A description now declares what failure looks like in a body
(`failureWhen`) and a provider may declare its own; `Story.bodies()` reads each recorded body once
against them, and a match is bolded in the table with the marker that fired beside the status
(`**200 · data.error**`), spelled out under it with the body, and counted in the title.

Three things it is careful about, each one a way the fix could have been worse than the bug. It parses
**nothing** when no marker was declared. A body is JSON only if it starts like one and only up to a
size, and a malformed one answers "could not read" rather than throwing — a debug story that crashes
is worse than one that is too quiet. And a body clipped at the recorder's 4000 characters is invalid
JSON, so the count of those is **printed**: a marker that could not be looked for is the same silence
one layer down. It reports; it does not decide. Whether a body-level failure should fail the ACTION is
a question about what steps assert, and this file is not where that is answered.

## drift

Claims-based on purpose. An earlier version swept every locator across every route and reported
**eight findings against a description that was correct**: a `store` matching 226 elements (its whole
point), one matching on a route no step uses it on, one matching nothing because it only exists after
a click. A checker that cries wolf is worse than none. The rules it settled on are in
[how-to/check-for-drift.md](../how-to/check-for-drift.md).

The same reasoning keeps a browser away from a `records: "terminal"` action — and reads its steps
anyway, naming each claim it cannot judge, because a report that quietly read half a description and
answered "all claims still hold" is the same lie from the other end. A count of *actions skipped* was
the first version of that and it said too little in one direction and too much in the other: it never
named the unverified sentence, and it reported ten silences as ten omissions on a description whose
terminal half asserts nothing. `Drift.inATape` reads them instead. One thing there it can judge
outright — an `expect` with no `text` never reaches the tape and never reaches the engine, so nothing
asserts it at all.

`Drift.sweep`, not `Drift.check`, is what `System.checkDrift` and therefore `witness check drift` call:
it builds `routeOf` out of `system.routeUrl`, launches the browser, carries the identity cookies and
drives the sign-in action. For a long time every test drove `check` with a `routeOf` of its own, so
`sweep` could resolve nothing at all and still print `all 0 claims still hold` and exit 0 (#103). The
test that holds it down launches a real browser at a `node:http` server it starts, which is why CI
installs a browser as well as the package.
