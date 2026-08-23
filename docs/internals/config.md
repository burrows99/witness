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

## explore: the other generator

`template.ts` says what a config COULD hold, from the types. `explore.ts` says what it SHOULD hold
for one product, from the product. Together they are why `init` need not hand anyone a file of
`"<name>": "…"` to fill in from memory.

The translation is cheap because `page.ariaSnapshot()` returns `role "name" [attrs]`, which is
already a `LocatorSpec`. What Playwright has no answer for — and what had to be written — is the
crawl, and emitting a *description* rather than test code.

Two sources per page, each for what it knows: the accessibility tree for what a person can see and
name, the DOM for placeholder attributes, because `forms` is consumed with `getByPlaceholder` and an
accessible name is the label wherever there is one.

It is the only part of `config/` that needs a browser, lazily, like everywhere else.

## template + types: generated from the source

Nothing in the template is a hand-maintained list. Fields come from the type declarations parsed out
of `schema.ts`; provider names are asked of the registries at the moment of printing. Add a field,
register a provider, and the template says so.

`types.ts` is a small TypeScript reader, not a full parser — it handles the subset `schema.ts` uses.
Extending the schema with a construct it does not know is the one way to break template generation,
and its tests are the guard.
