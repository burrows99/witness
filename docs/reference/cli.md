# CLI

```
npx witness <noun> <verb> [args…] [--flags]
```

No arguments prints every noun and verb this description declares. Results go to **stdout as JSON**;
progress, warnings and the "what broke" pointer go to **stderr**, so `… | jq` works.

## Always there

| command | what it does |
|---|---|
| `stack status` | reachability of every service, whether its container is up |
| `check drift [<sign-in action>]` | verify every claim the description makes · exit 1 if any broke |

## There when the description earns it

| command | present when |
|---|---|
| `api <get\|post\|put\|patch\|delete> <path> [json]` | any service declares an `api` — authenticated the way a declared operation is |
| `db sql "<query>"` | a `database` is declared |
| `video render` | rebuild the MP4s from the last run's recordings |
| `action list` / `action show <a>` / `action run <a…>` | any action is declared |
| `stub list` / `stub show <s>` | any `stubs` are declared |
| *your own nouns* | each entry in the `cli` block |

## `action run`

```
npx witness action run <action…> [key=value…] [--parallel] [--retries=N]
```

- **several actions** run in one browser, in order, as one continuous recording
- `--parallel` gives each its own browser and stitches them into panes ([how-to](../how-to/run-things-in-parallel.md))
- `--retries=N` re-runs a failure in a fresh browser, keeping each attempt's evidence
- `key=value` supplies the action's `inputs`
- `HEADED=1` shows the browser

Exit code is 1 if any action failed.

## Your own nouns

```jsonc
"cli": { "orders": { "summary": "the order book", "verbs": {
  "show":   { "args": ["orderId"], "operation": "orders.show" },
  "recent": { "args": ["limit"], "query": "recentOrders" },
  "as":     { "args": ["email"], "signIn": "web" }
} } }
```

A verb is one of: `operation` (call a declared API operation, `client` to pick the service),
`query` (run a declared SQL query), or `signIn` (mint a sign-in link for an app). No code.
