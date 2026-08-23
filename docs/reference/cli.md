# CLI

```
npx witness <noun> <verb> [args…] [--flags]
```

No arguments prints every noun and verb this description declares. Results go to **stdout as JSON**;
progress, warnings and the "what broke" pointer go to **stderr**, so `… | jq` works.

`npx witness` is for a project that has this as a dependency — npm links the bin, so the command
resolves. **Inside a checkout of this repository it does not**: npm does not link a package's own
`bin` into its own `node_modules/.bin`, so `npx` misses and goes to the registry for an unrelated
package named `witness`. Run `./bin/witness` there, which is what `/flow`, `docs/agent/` and the
tutorial say.

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
| `config explore [<service>] [--pages N] [--depth N]` | always — walks the app and prints the description it implies |
| `init` | always — writes `.witness/`, populated from the compose file when there is one |
| `skill [--write]` | always — the instructions, generated from what this copy can do; `--write` refreshes `.witness/SKILL.md` in place |
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

## `config explore`

```
npx witness config explore [<service>] [--pages=12] [--depth=2]
```

Crawls same-origin from the routes already declared (or `/`), carrying the config's identity cookies,
and prints a JSONC fragment: `routes` and `locators` from each page's aria snapshot, `forms` from the
placeholder attributes, `api.operations` from the XHR the app made while being walked. It never
writes the config. What the caps left out is printed, not dropped silently.

Each page is read once it has **settled**, not once its document is done — a client-rendered app is an
empty shell at `domcontentloaded`. A page that still offers nothing is named in the fragment: an empty
page is nearly always one behind a sign-in, not one with nothing on it.

**It walks your app and nothing else.** A sign-in that hands off — `/login/generic_oauth`,
`/user/oauth2/keycloak`, `/api/auth/idp/microsoft/start` — is a link on your own origin that answers
302 to an identity provider, so those shapes are skipped before anything is requested. Whatever else
turns out to have left this origin is judged on where the navigation **landed**, and dropped rather
than read: a description that named the third party's screens would be describing somebody else's
product. Both kinds are named in the fragment, so a route you do want described can be declared by
hand.

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
