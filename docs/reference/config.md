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

**`kind`** — `in-house` or `third-party`. A third party is not restartable, not resettable, usually
shared, and the likeliest source of a flake that is nobody's fault.

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

## Say a thing once

The normaliser fills in what position already says. Inside a service you write `{ "containerEnv": "K" }`,
not `{ "containerEnv": { "service": "gitea", "key": "K" } }` — anywhere in the service, at any depth. An
action under a service needs no `app` and no `gitea.` in its own name.

## Templates

Any string in a step, `verify`, `with` or a query param is filled from the values gathered so far.
`{order.status}` and `{rows.length}` are dotted paths. `{secret.adminPass}` reaches a declared secret.
An object or array fills as JSON, never `[object Object]`.
