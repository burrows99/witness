# Config

One file: `.witness/config.jsonc` (JSON with comments). Everything that differs between products is
here; the harness holds no product knowledge at all.

## Top level

| key | |
|---|---|
| `name` | what the command line is called |
| `services` | **the bulk of it** — see below |
| `identities` | who the system can be; `cookies` are injected into every browser context |
| `secrets` | credentials shared by *everything* — one CI token, one org key |
| `actions` | sequences about more than one service (a one-service action belongs under it) |
| `cast` | the real rows a scenario is pinned to, and why that one |
| `stubs` | local stand-ins for third parties the app calls **server-side** |
| `clients` | extra API clients beyond a service's own |
| `databases` | extra databases beyond the default one, by the service that runs each |
| `suffixVar` | the `.env` variable holding the suffix on every container name (default `WT`) |
| `video` | how recordings become MP4s |
| `evidence` | `{ dir?, links? }` |
| `cli` | your own nouns and verbs — see [cli.md](cli.md) |
| `root` | marker files identifying the checkout, for a config kept outside `.witness/` |

`api`, `database` and `apps` also exist at the top level, deprecated. Declare them under their
service; old files still load.

## A service

```jsonc
"gitea": {
  "kind": "in-house", "port": 3000, "portVar": "GITEA_PORT",
  "container": "witness-gitea", "containerVar": "GITEA_CONTAINER",
  "url": "…", "urlVar": "…",
  "probe": { "path": "/api/healthz", "contains": "pass" },

  "records": "terminal", "shell": "docker exec -it … bash", "pane": { "height": 1350, "fontSize": 14 },

  "secrets":  { "adminPass": { "containerEnv": "ADMIN_PASSWORD" } },
  "api":      { "auth": {…}, "operations": {…}, "kind": "rest" },
  "app":      { "routes": {…}, "locators": {…}, "forms": {…}, "signIn": {…} },
  "database": { "user": "…", "database": "…", "credential": {…}, "queries": {…} },
  "actions":  { … }
}
```

**Where it runs.** `port` is the default; `portVar` names the `.env` variable that overrides it, so a
second checkout with its own ports needs no wrapper. `container` is the name *without* the worktree
suffix (`WT` by default). `probe` is `"http"`, `"container"`, or an object — the object form is how
`stack status` tells "something is listening" from "**our** thing is listening".

**`kind`** — `in-house` or `third-party`, or absent. A third party is not restartable, not resettable,
usually shared, and the likeliest source of a flake that is nobody's fault — so a wrong one is worse
than none, and `init` leaves it out unless the compose file actually says (a `build:`).

**`records: "terminal"`** — for a service with no screen. `pane` is the size it is filmed at
(`width`, `height`, `fontSize`; 1280x900 at 20pt by default, which is about thirty rows) and can be
set on one action instead. See [how-to/record-a-terminal.md](../how-to/record-a-terminal.md).

## `api`

```jsonc
"api": {
  "kind": "rest",
  "auth": { "admin": { "provider": "apiKey", "header": "x-api-key", "from": { "secret": "adminKey" } } },
  "operations": { "orders.show": { "method": "GET", "path": "/v1/orders/{orderId}", "auth": "admin" } }
}
```

The first service to declare one is what bare `witness api …` talks to; the rest are reachable by
name from a step (`{ "api": { "client": "mailpit", … } }`).

**`failureWhen`** — what a failure looks like in a response *body*, for an app that answers `200` and
puts the error in the payload:

```jsonc
"failureWhen": { "path": "data.error", "present": true }
```

`path` is a dotted path into the parsed body; `present: true` fires when there is something there, and
`equals` when it is a particular value (`{ "path": "status", "equals": "failed" }`). Without one, the
debug story judges a request by its status code alone — so most Python and PHP APIs, every job whose
failure arrives by polling, and every GraphQL query read as healthy. `graphql` declares its own and
needs none: a non-empty `errors[]` is a failure by specification.

It changes what [`debug.md`](../how-to/debug-a-failing-run.md) **reports**, never whether a step
passed. What should fail a run is what an `expect` or a `check` says.

## `app`

- `routes` — screen name → path, `{param}` for an argument. `goto` and `waitForUrl` take these names.
- `locators` — the handful of things actions assert on directly, named once so one line changes.
- `forms` — named forms: field name → the placeholder that finds the input.
- `signIn` — a magic-link sign-in as data: `mint` (the operation), `tokenParam`, `landing`,
  `landsOn`, `exchange`, `afterInject`. An impersonation link, a passwordless email link and a
  support "log in as" button are the same three steps.

## `database`

`user`, `database`, `credential` (a secret source, or a bare string), `queries` (named SQL with
`{param}` placeholders — one place to read what we assert).

The first service to declare one is the default — what bare `witness db sql "…"` runs against. Every
one of them, that one included, is also reachable by the service that runs it: `--on=<service>` from
the command line, `app.database("<service>")` in code. An app database plus an authz, queue or metrics
database is the ordinary case, not a shape to describe your way around.

The order is yours, and it is the whole of the rule — so `witness init` does not leave it to chance.
`docker compose config` returns services **alphabetically**, which made `mariadb` the default on a
stack whose app runs on Postgres, so a generated config puts a database the compose file says
something `depends_on` above one nothing mentions. Where no `depends_on` exists anywhere the order is
left exactly as compose gave it — a guess in a generated file is worse than an order somebody has to
look at — and the generated header says which database it picked whenever there is more than one.

## Say a thing once

The normaliser fills in what position already says. Inside a service you write `{ "containerEnv": "K" }`,
not `{ "containerEnv": { "service": "gitea", "key": "K" } }` — anywhere in the service, at any depth. An
action under a service needs no `app` and no `gitea.` in its own name.

## Templates

Any string in a step, `verify`, `with` or a query param is filled from the values gathered so far.
`{order.status}` and `{rows.length}` are dotted paths. `{secret.adminPass}` reaches a declared secret.
An object or array fills as JSON, never `[object Object]`.
