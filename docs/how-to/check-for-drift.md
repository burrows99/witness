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

Without a sign-in action it says exactly what it could not reach rather than guessing.
