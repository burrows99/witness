# Steps

Every verb an action can use. One object per step; a step object holds one verb plus its modifiers.

## Getting somewhere

| verb | shape | notes |
|---|---|---|
| `goto` | `{ app?, route?, url?, params? }` | prefer `route` — `url` disconnects `portVar` |
| `reload` | `true` | for "and it survives a refresh", which `goto` does not say |
| `waitForUrl` | `{ route?, url?, app?, service?, timeout? }` or a string | `url` is a **regular expression**, not a glob; `service` is any path on another service's origin |
| `wait` | `1200` | milliseconds. Last resort — prefer waiting for a thing |

## Doing something

| verb | shape | notes |
|---|---|---|
| `click` | a [locator](#locators) | |
| `type` | `{ on, value, delay? }` | key by key — an instantly-full field reads as a bot on film |
| `fill` | `{ on, value }` | at once. Faster, worse to watch |
| `press` | `"Enter"`, `"Control+A"` | |
| `fillFields` | `{ "Heading": "…", "Body": "…" }` | by label; `within` scopes it to a dialog |
| `upload` | `"seed.pdf"` or `["a.pdf", "b.pdf"]` | a file under `.witness/fixtures/`; `to` says what to attach it to |

### Attaching a file

```jsonc
{ "upload": "seed.pdf", "to": { "testId": "dropzone" } }
```

A **filename**, not a path: files live in `.witness/fixtures/`, beside the description that names
them, so the same step finds the same file in the next checkout. An absolute path is taken as
written and is the one form that cannot survive being cloned. A fixture that is not there fails
naming the path it looked at, before a browser is asked for anything.

`to` names a locator, the same way `click` does — and **either half works**. A styled dropzone is a
`<div>` with the real `<input type="file">` hidden inside it, where no role and no label can reach
it; name the dropzone you can see and the input inside it is found. Name the input directly and it
is used as it is. A `<label>` works too, because Playwright retargets one to the control it is for.

The two ways it fails say which of the two was missing, because they want opposite fixes: a `to`
that matches nothing is a misspelt name, and a `to` that matches something with no file input in it
is the right name one element off.

## Claiming something

| verb | shape | notes |
|---|---|---|
| `expect` | `{ on, state?, text?, count?, timeout?, because? }` | about the **screen** |
| `check` | `{ that, equals?, not?, contains?, matches?, atLeast?, atMost?, because? }` | about the **values gathered** — `matches` is a regex |

`because` becomes the failure message. Write it for the person reading the failure.

## A sign-in that leaves the app

Behind SSO, social login and every hosted identity provider is the same sequence: the app hands the
browser to somebody else, a form is filled over there, and the browser comes back with a session.
There is no `signIn` verb for it — it is the ordinary verbs, plus one word for the origin it goes to:

```jsonc
{ "goto": { "route": "login" } },
{ "click": { "role": "link", "name": "Keycloak" } },
{ "waitForUrl": { "service": "keycloak" } },          // where it expects to LAND — another origin
{ "type": { "on": { "label": "Username" }, "value": "{secret.providerUser}" } },
{ "type": { "on": { "label": "Password" }, "value": "{secret.providerPassword}" } },
{ "click": { "role": "button", "name": "Sign In" } },
{ "waitForUrl": { "route": "home" } },                // …and where it expects to come BACK to
{ "expect": { "on": { "text": "Welcome" }, "because": "the session took" } }
```

`service` is any path on that service's origin, taken off the stack — so the provider's port is
declared once, in the service, exactly like `route` does it for this app's own. A literal
`"localhost:8092"` would work and is the thing to avoid: it is a substring of an address rather than
an address, and it disconnects `portVar`.

Credentials belonging to the provider are still declared under the app that has to type them, with
the long form that names whose container they live in:

```jsonc
"providerPassword": { "containerEnv": { "service": "keycloak", "key": "KC_BOOTSTRAP_ADMIN_PASSWORD" } }
```

`config explore` will not walk a link like that one — it refuses anything that hands off to an
identity provider, because a crawl must reach nobody it was not pointed at. A step naming the
provider is somebody pointing at it, by the name their own stack gives it. That is the whole
difference, and it is the reason this is a step rather than something a crawler decides.

## Gathering

| verb | shape | notes |
|---|---|---|
| `store` | `{ from, as, all? }` | read the screen. `all` gives an array |
| `api` | `{ operation, client?, params?, body?, as?, pick? }` | ask a declared operation mid-flow |
| `query` | `{ name, params?, as? }` | run a declared query — what was *stored* |
| `capture` | `{ url, method?, as, pick?, timeout? }` | wait for a response and keep part of its body |
| `select` | `{ from, where, pick?, as }` | pick one item out of a stored list |

Everything stored is available to later steps as `{name}`, dotted for depth (`{order.status}`,
`{rows.length}`).

A **doubled** brace is not a placeholder — `{{…}}` is left exactly as it stands, which is how
`docker ps --format '{{.Names}}'` gets into a step. Not every string here was written as a template,
and reading `{.Names}` out of that one as a parameter nobody supplied made a literal command
unrecordable.

## Composing

| verb | shape |
|---|---|
| `run` | `"signIn"` or `{ action, with? }` — `with` is a template map, so `{ "q": "{term}" }` forwards an input |

The composed action's evidence lands **inside the step that ran it**.

## Narrating

| verb | shape | notes |
|---|---|---|
| `slide` | `{ title, lines?, kicker?, tone?, ms? }` | full-frame card spliced into the video. `tone`: `neutral` \| `bad` \| `good` |
| `caption` | `{ text, sub? }` | drawn into the page for a moment |
| `frame` | `"the order, cancelled"` | a still named for what it shows; `fullPage: true` for below the fold |
| `note` | `"why this step exists"` | for the trace only |

## Locators

A string is a CSS selector. The object form:

`role` · `name` · `exact` · `placeholder` · `testId` · `label` · `text` · `css` ·
`labelledInput` / `labelledTextarea` (a label whose input is a sibling, no `htmlFor`) ·
`nth` (0-based, or `first`) · `within` (scope to a dialog, card, section) · `frame` (a cross-origin iframe)

`exact` applies to whichever of `name`/`label`/`placeholder`/`text` is used — without it, a field
called "Password" also matches the button beside it called "Show password".

Prefer `role`+`name`, then `label`/`placeholder`, then `testId`. `css` last: it survives a rewording
and breaks on a restyle, which is the wrong way round, and it can match something invisible — so the
run goes green and the picture shows nothing.

`npx playwright codegen <url>` writes these for you, in that same order of preference.
