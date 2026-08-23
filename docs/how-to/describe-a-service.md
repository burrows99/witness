# Describe a service

## Do not start from a blank file

```bash
npx witness init                      # reads the compose file beside you
npx witness config explore            # the service with screens
npx witness config explore mailpit --pages=20 --depth=3
npx witness config explore grocy --as=grocy.signIn   # signed in first, then walked
```

`init` reads `docker compose config` and writes the whole `services` block: where each service runs,
its `portVar`, its container, whether it is yours, its database, and the environment variables holding
its credentials — as **sources**, never values, so the file can be committed. Nothing is retyped from
the compose file, which is the first thing every description gets wrong.

`config explore` then walks the running app and prints the description it implies — routes, locators, forms, and the
operations the app called while being walked. Nothing is written: merge and trim by hand, because a
generated name is worse than the one you would choose.

**How much of that you get depends on how the app is built, and the `operations` block most of all.**
It is read off the XHR the app makes while being walked, so it is rich on an SPA or an API-first
product and close to empty on a server-rendered one — there is very little to observe on a
server-rendered surface, and less again signed out. Six pages of Gitea, the app in this repository's
own stack, produce twelve routes, a locators block and a forms block, and **no `operations` block at
all**. That is the feature working: an API map is worth having where one exists to be read, and
inventing one where it does not would be worse than saying nothing. Declare `operations` by hand from
what the product documents.

Three honest limits.

**A `forms` entry is a placeholder**, because that is what `page.getByPlaceholder` takes — so a field
with no placeholder attribute cannot be one, however well labelled it is. It is still FOUND: fields are
found by being fields, and the ones that cannot go in `forms` are named in the fragment, with their
labels, under "Fields with no placeholder". Fill those with a **`fillFields`** step, which matches by
label — exactly, then by prefix. Rule of thumb: `forms` where the app has placeholders, `fillFields`
where it labels instead, and a login form is usually the second (gitea's, grocy's and linkding's all
are). Nothing stops one form using both.

**Anything behind a login needs a way in.** `--as=<action>` runs a declared sign-in first and walks
with the session it leaves — the same argument `check drift` takes, for the same reason. Without it a
crawl describes the front door: grocy — stock, chores, recipes, equipment — walks exactly one page,
`/login`. An `identity` whose cookies get you in works too, where a session cookie can be had out of
band. A crawl where every page walked carried a password field says so in the fragment, because
`Walked 1 page` otherwise reads as "this app is small" rather than "I could not get in".

**A sign-in that leaves the app is not walked** — an OAuth or SAML start endpoint is a same-origin
link that redirects to an identity provider, and exploring your stack must not send a third party a
request. It is named in the fragment rather than dropped silently.

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
- **A second service with a `database`** is the same idea: the first is what bare `witness db sql`
  runs against, and any of them is reachable as `--on=<service>`. An app database plus an authz one
  is ordinary — it is not a shape to describe your way around.
- **Two services naming one `container`** is how a container publishing two ports is described,
  because a service holds one port. `init` writes them — `demo` on 3000 and `demo-5001` on 5001, or
  `demo-api` where the compose file named the port — and it is not the copy-paste it looks like:
  delete the one that looks duplicated and you have deleted the API. The `container` is what ties
  them together, not the name, so rename either freely.
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
