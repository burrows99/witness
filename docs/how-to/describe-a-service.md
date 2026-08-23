# Describe a service

## Do not start from a blank file

```bash
npx witness init                      # reads the compose file beside you
npx witness config explore            # the service with screens
npx witness config explore mailpit --pages=20 --depth=3
npx witness config explore grocy --as=grocy.signIn   # ran that action first, then walked
npx witness config explore docs --as=docs.upload     # any action: whatever unlocks the app
npx witness config explore web | npx witness config merge -   # and applied
```

`init` reads `docker compose config` and writes the whole `services` block: where each service runs,
its `portVar`, its container, whether it is yours, its database, and the environment variables holding
its credentials — as **sources**, never values, so the file can be committed. Nothing is retyped from
the compose file, which is the first thing every description gets wrong.

`config explore` then walks the running app and prints the description it implies — routes, locators,
forms, and the operations the app called while being walked. It writes nothing itself, because a
generated name is worse than the one you would choose: rename and trim first, then apply what is left
with `config merge -`, which validates before it writes, leaves every comment in the description where
it is, and writes nothing at all for a field already saying that. Piping the whole fragment straight
in is the shortcut, and it is a shortcut past the trimming rather than instead of it.

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

**Anything behind a gate needs a way past it.** `--as=<action>` runs a declared action before the
crawl and walks with everything it left behind — the session, whatever it wrote on the server, the
URL it landed on. A sign-in is the commonest one and not the only one: grocy — stock, chores,
recipes, equipment — walks exactly one page, `/login`, without `--as=grocy.signIn`; and an app whose
landing screen is a dropzone walks exactly one page for a reason with no login in it, because nothing
links anywhere until a file has been dropped on it and every other route takes an id the upload
mints. Whatever gets past your gate is an action worth declaring anyway. An `identity` whose cookies
get you in works for the login case, where a session cookie can be had out of band. A crawl where
every page walked carried a password field says so in the fragment, because `Walked 1 page` otherwise
reads as "this app is small" rather than "I could not get in".

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
- **Nothing here has to be typed into the file by hand.** `config merge <file|->` applies a whole
  block, `config set <field> <value>` writes one field by the name this page addresses it with, and
  `action add`/`action rm` take one action. All of them validate before they write and leave the
  comments alone — see [cli.md](../reference/cli.md#config-merge-config-set-action-add-action-rm).

## Say a thing once

| instead of | write |
|---|---|
| `{ "containerEnv": { "service": "web", "key": "K" } }` inside `web` | `{ "containerEnv": "K" }` |
| an `auth` block respelling a declared secret | `{ "secret": "adminKey" }` |
| `"waitForUrl": "localhost:3000/…"` | `{ "waitForUrl": { "route": "home" } }` |

Each of those was in this repository's own description, and each is a second place to change and one
place to forget.
