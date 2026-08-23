# Find what stopped matching

A locator does not announce that it stopped resolving. It waits until a run reaches that step, times
out, and fails — telling you about exactly one of them, thirty seconds later.

```bash
npx witness check drift <the action that signs in>
```

```
3 of 7 claims no longer hold

Nothing matches these any more — a run will time out on them:
  grafana.openDashboards · expect  testId=data-testid CreateNewButton New button — nothing matches it on dashboards
  grafana.startADashboard · expect  text=Add a panel to visualize your data — nothing matches it on newDashboard
  grafana.browseConnections · type  placeholder=Search Grafana plugins — nothing matches it on addConnection
```

Exit code 1, so a pipeline can gate on it. Measured on this repository's own description run against
an older Grafana: **three breakages in 7 seconds**; a single run found one, in 47.

## What it checks, and what it will not

It reads the **claims the description already makes** — a step's locator *and* the route a `goto` put
the page on — and verifies exactly those. It does not sweep every locator across every route, because
an earlier version that did reported eight findings against a description that was **correct**:

- a `store` matching 226 elements, which is the entire point of the `store` using it
- a locator matching twice on a route no step ever uses it on
- one matching nothing, because it only exists after a click

A checker that cries wolf is worse than none. The rules it follows now:

- after a `click`, `fill` or `press` the page is somewhere no URL reproduces → nothing is claimed
  again until the next `goto`
- a `store` reading a list is entitled to find it **empty**
- more than one match is wrong only where the step needs one
- the sign-in action's own steps are checked **before** anybody is signed in
- a route that **redirects** is `unchecked`, not `gone`
- a `records: "terminal"` action has no screen → its claims are **named, not checked**, one line each

Without a sign-in action it says exactly what it could not reach rather than guessing.

## The half with no screen

A terminal action types at a shell. There is no route to visit and no locator to count, so a browser
driven at one waits out a timeout on `locator('prompt')` and reports the action as broken — which is
the checker's own assumption wearing the words of a finding. Not checked on a page, then. It is still
**read**, because a count of actions skipped tells nobody *which* sentence went unverified — and an
action that asserts nothing had nothing skipped in the first place:

```
all 4 claims still hold (1 could not be checked)
```

That is this repository's own description: ten terminal actions, and not one of them asserts anything.
They type, wait, and let the frame speak.

One that *does* assert is named, with what would have to happen to judge it:

```
all 4 claims still hold · 1 claim made in a tape rather than on a screen

Not checked:
  atAPrompt · expect  "1 row" is claimed in a tape as `Wait+Screen` — only a recording can judge whether it still appears
```

`expect: { text }` becomes `Wait+Screen /…/` in the tape: the same claim a browser step makes, held
against the pane by VHS instead of against the DOM by Playwright. What it matches exists only once the
command has run, so checking it *is* a run — and being faster than a run is the whole of what this is
for. Never guessed at, therefore, and never counted as holding.

The one thing here that **can** be judged without vhs is a claim VHS is never told about. Only
`expect.text` reaches a tape; an `expect` carrying a `state`, a `count` or nothing but a locator
describes a screen a terminal does not have and is dropped on the way in — and a terminal action does
not go through the engine either, so nothing else reads it:

```
  atAPrompt · expect  a tape carries an `expect` only as `text`, and this one has none — nothing asserts it, here or in the recording
```

Naming a terminal action as the *sign-in* action is refused before a browser opens, because a shell
cannot sign one in.
