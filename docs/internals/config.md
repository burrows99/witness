# config

`src/config/` — reading the description, and filling in what position already implies.

| file | |
|---|---|
| `schema.ts` (221) | the description of one product, as types. The authoritative shape |
| `load.ts` (125) | read, strip comments, `fill()` templates, `reach()` dotted paths |
| `normalise.ts` (158) | hoist what a service owns to what the system reads |
| `template.ts` (258) | generate the starter config from the types and registries |
| `types.ts` (254) | read the config's own types back out of the source |
| `explore.ts` | read a description off the *running app* |
| `compose.ts` | read a description off the *compose file* |

## Why it is read, not imported

`fs.readFileSync`, not `import`. These files are loaded by two runtimes — Node directly for the CLI,
a bundler for anything importing the library — and JSON module semantics differ between them.

## normalise: say a thing once

A description used to put everything at the top level and make each entry name its service back
again: `api.service`, `apps.web.service`, `database.service`, and every action carrying
`"app": "grafana"` plus a `grafana.` typed into its own name. Four repetitions of one fact, each a
place to forget.

Now position says it. `normalise` hoists a service's `api`/`app`/`database`/`secrets`/`actions` up,
filling in the service name from where they were. `inThisService()` fills a bare `containerEnv`
**anywhere inside a service, at any depth** — the point being that you never write the service name
inside its own block.

`unfilled()` detects a config still holding the template's placeholders, so `witness init` followed
by running something says "you have not filled this in" rather than failing on a made-up hostname.

`OLDER_NAME = "password"` is the alias for `credential`. The rename was not cosmetic: the field holds
a *source*, and a field literally named `password` in a type declaration is something every secret
scanner is right to ask about — [agent/knowledge.md](../agent/knowledge.md) has the incident.

## Three generators, one job

| from | fills |
|---|---|
| `template.ts` | the types | every field, documented — the reference |
| `compose.ts` | `docker compose config` | where each service *is*: ports, containers, database, secret sources |
| `explore.ts` | the running app | what a person *sees*: routes, locators, forms, operations |

Between them, `init` writes a config somebody can run in the next minute instead of a file of
`"<name>": "…"`. What none of them can produce is `actions` — a sequence a person performs, and the
claims it makes, cannot be read off an app sitting still.

`compose.ts` shells out to `docker compose config --no-interpolate --format json` rather than parsing
YAML: the CLI is always present and always agrees with what compose just did (the same reasoning
`Docker` gives), it normalises the several shapes compose accepts, and JSON needs no dependency.
`--no-interpolate` is load-bearing — without it `${GITEA_PORT:-3020}` arrives as `3020` and the
variable name, which is what `portVar` exists to keep, is gone. It is right for ports and wrong for
`container_name`, where the same flag leaves `acme-api${WT:-}` — a container that has never existed —
so a trailing `${VAR}` is stripped back into `suffixVar`, which is the knob already expressing it.

Four things the file says that a transcription misses, and each one made a running service read as
DOWN: compose NAMES a container nobody named (`<project>-<service>-1`, off the project in the same
document); a published port is not an HTTP port, so a database or a broker needs the container probe
however many ports it publishes; `mysql` and `mariadb` are databases; and `build:` is evidence of
in-house while its absence is evidence of nothing, so `kind` is omitted rather than guessed.

## explore: the other generator

`template.ts` says what a config COULD hold, from the types. `explore.ts` says what it SHOULD hold
for one product, from the product. Together they are why `init` need not hand anyone a file of
`"<name>": "…"` to fill in from memory.

The translation is cheap because `page.ariaSnapshot()` returns `role "name" [attrs]`, which is
already a `LocatorSpec`. What Playwright has no answer for — and what had to be written — is the
crawl, and emitting a *description* rather than test code.

Two sources per page, each for what it knows: the accessibility tree for what a person can see and
name, the DOM for placeholder attributes, because `forms` is consumed with `getByPlaceholder` and an
accessible name is the label wherever there is one. A field carries both strings — the placeholder is
what MATCHES it and the field's `name`/`aria-label`/label is what NAMES it. Naming from the
placeholder called an email box `youOrganisationCh`.

**The output has to be the same twice.** A description is committed, so anything read off live data
is a false diff waiting to happen: `templated()` turns an id segment into `{id}` for routes and for
operations both, a page is recorded where it LANDED, an identical form is written once, and
`steady()` takes the rendered number out of a locator's name — `HTML Check 95%` stops resolving at
94% as surely as it reads differently. The check that catches this is a whole run rendered twice and
compared; a per-function test cannot see it, which is why three of these lived through a green suite.

Same-origin is judged on where a navigation **landed**, not on the href it started from — a local
path that answers 302 defeats the second version of the check entirely — and auth-handoff shapes are
skipped before any request goes out. The one thing a crawler must not do is walk out of the product
it was pointed at.

It is the only part of `config/` that needs a browser, lazily, like everywhere else.

## template + types: generated from the source

Nothing in the template is a hand-maintained list. Fields come from the type declarations parsed out
of `schema.ts`; provider names are asked of the registries at the moment of printing. Add a field,
register a provider, and the template says so.

`types.ts` is a small TypeScript reader, not a full parser — it handles the subset `schema.ts` uses.
Extending the schema with a construct it does not know is the one way to break template generation,
and its tests are the guard.
