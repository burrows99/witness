# Describe a service

## Do not start from a blank file

```bash
npx witness config explore            # the service with screens
npx witness config explore mailpit --pages=20 --depth=3
```

It walks the running app and prints the description it implies — routes, locators, forms, and the
operations the app called while being walked. Nothing is written: merge and trim by hand, because a
generated name is worse than the one you would choose.

Two honest limits. **`forms` finds inputs by placeholder**, so an app that labels its inputs instead
produces a thin `forms` block — use `fillFields`, which matches by label. And anything behind a login
is only reachable if the config declares an `identity` whose cookies get you in.

Then the rest of this page is the trimming.

## The shape

A service carries everything true about it. The top level carries only what is shared.

```jsonc
"services": {
  "web": {
    // Where it runs. From the same `.env` compose reads, so a second checkout needs no wrapper.
    "kind": "in-house", "port": 3000, "portVar": "WEB_PORT", "container": "acme-web",
    "probe": { "path": "/health", "contains": "ok" },

    // Its credentials. `containerEnv` here means THIS service's container.
    "secrets": { "adminKey": { "containerEnv": "ADMIN_KEY" } },

    // What it can be asked. The first service with an `api` is what `witness api …` talks to.
    "api": {
      "auth": { "service": { "provider": "apiKey", "header": "x-api-key", "from": { "secret": "adminKey" } } },
      "operations": { "orders.show": { "path": "/v1/orders/{orderId}", "auth": "service" } }
    },

    // What a person sees of it.
    "app": { "routes": { "order": "/orders/{orderId}" }, "locators": { … } },

    // What can be DONE with it.
    "actions": { "cancelOrder": { … } }
  }
}
```

## Rules worth knowing

- **`kind`** says whose software it is. A third party is not restartable, not resettable, usually
  shared, and the likeliest source of a flake that is nobody's fault.
- **`portVar`** names the `.env` variable the port comes from, so a second checkout with its own ports
  works without a wrapper script. Hardcoding the port anywhere else makes it a lie.
- **`probe`** is how `stack status` decides it is up — and, with `contains`, how it decides the thing
  answering is *ours*.
- **A second service with an `api`** becomes a named client, reachable from a step as
  `{ "api": { "client": "mailpit", "operation": "messages" } }`.
- **A service with no screen** takes `"records": "terminal"` — see
  [record-a-terminal.md](record-a-terminal.md).

## Say a thing once

| instead of | write |
|---|---|
| `{ "containerEnv": { "service": "web", "key": "K" } }` inside `web` | `{ "containerEnv": "K" }` |
| an `auth` block respelling a declared secret | `{ "secret": "adminKey" }` |
| `"waitForUrl": "localhost:3000/…"` | `{ "waitForUrl": { "route": "home" } }` |

Each of those was in this repository's own description, and each is a second place to change and one
place to forget.
