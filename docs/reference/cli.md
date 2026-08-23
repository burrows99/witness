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
| `api <get\|post\|patch\|delete> <operation\|/path> [key=value…] [json]` | any service declares an `api` — a declared operation by name, or any other route on it |
| `db sql "<query>" [--on=<service>]` | a `database` is declared — `--on` names one of the others |
| `video` | rebuild the MP4s from the recordings on disk — a RUN only renders what it just recorded, this re-renders everything |
| `action list` / `action show <a>` / `action run <a…>` | any action is declared |
| `stub list` / `stub show <s>` | any `stubs` are declared |
| `config explore [<service>] [--as=<action>] [--pages=N] [--depth=N]` | always — walks the app and prints the description it implies |
| `init` | always — writes `.witness/`, populated from the compose file when there is one |
| `skill [--write]` | always — the instructions, generated from what this copy can do; `--write` refreshes `.witness/SKILL.md` in place |
| *your own nouns* | each entry in the `cli` block |

## `api`

```
npx witness api get <operation|/path> [key=value…] [json]
```

The argument is **an operation's name first, and a path second**: the `api.operations` block is the
list of everything this description can ask the running app, and calling one by name is what it is
for. `key=value` supplies that operation's parameters, the same way `action run` supplies an action's
inputs — `api get getReport reportId=7`.

A **path starts with `/`** and is the escape hatch it always was: any route, authenticated with the
same credential a declared operation would use. Reach for it twice for the same route and give it a
name in the config instead.

Anything that is neither is a mistake worth naming, so it says so — with the operations that do
exist — rather than sending it. A named operation carries its own method, so the verb is how the
command is typed rather than what goes on the wire; `get` is the one to reach for.

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
npx witness config explore [<service>] [--as=<action>] [--pages=12] [--depth=2]
```

Crawls same-origin from the routes already declared (or `/`), carrying the config's identity cookies,
and prints a JSONC fragment: `routes` and `locators` from each page's aria snapshot, `forms` from the
fields it found, `api.operations` from the XHR the app made while being walked. It never writes the
config. What the caps left out is printed, not dropped silently.

**`--as` names an action that signs in**, and it is the same argument `check drift` takes, for the same
reason: a sign-in is already described, as an action, and without one a crawl of an app whose value is
behind a login describes the login page and stops. It is driven on the page the crawl then walks with,
so the session it leaves is the session every navigation carries; a `records: "terminal"` action is
refused, because it has no screen to sign a browser in on. The requests the sign-in itself makes are
not collected as `operations` — that action is already described, and folding them in would make the
block depend on whether `--as` was passed.

**A field is found by being a field**, not by carrying a placeholder — `input`, `textarea` or `select`,
laid out, and inside a `form` where the page has one; a button, a checkbox and a hidden token are not
fields to fill. A `forms` entry is still a placeholder, because that is what `getByPlaceholder` takes,
so fields without one are named separately in the fragment with their labels and belong in a
`fillFields` step. And a crawl where every page walked carried a password field says so: `Walked 1 page`
otherwise reads as "this app is small" rather than "I could not get in".

**A fragment is meant to be committed, so it describes screens rather than rows.** A path segment
that is an id collapses to `{id}` — in routes now as well as in operations — a page is recorded where
it **landed** rather than where it was asked for, a form found twice is written once, a field is named
for what it IS (`name`, `aria-label`, its label) and valued with the placeholder that finds it, and a
locator is not named after a number the app rendered. Two runs against an unchanged app produce the
same bytes; anything less and `check drift` inherits the wobble and a regenerated fragment diffs as
churn.

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
