# Internals

For working *on* the harness. If you are working *with* it, you want
[reference](../reference/) or [how-to](../how-to/).

`src/` is eleven areas plus a composite root. Nothing imports downward past its own area's `index.ts`.

| area | what it owns |
|---|---|
| [system](system.md) | the composite root — assembles a product's parts from one config file |
| [config](config.md) | reading the description, filling in what position implies, generating the template |
| [actions](actions.md) | the step dispatcher and the runner behind `action run` |
| [browser](browser.md) | locators, screens, sign-in, the narration drawn into the page |
| [http](http.md) | one thin API client and the named operations over it |
| [database](database.md) | reading what was *stored*, out of band |
| [environment](environment.md) | where the stack is, the containers, `.witness/` |
| [evidence](evidence.md) | where artefacts go and what gets written there |
| [diagnostics](diagnostics.md) | the trace, DevTools-as-data, the debug story, drift |
| [providers](providers.md) | every named way of touching the outside world |
| [cli](cli.md) | the git-style command line |
| [skill](skill.md) | the instructions handed to whoever is driving |

## Two constraints that shape everything

**Zero runtime dependencies.** Playwright is an optional peer — half of what this does (find a stack,
ask an API, read a database, stand in for a third party) needs no browser, so nothing imports it at
the top of a file. ffmpeg and VHS are optional binaries: missing means a warning, never a failure.

**Node 22 native TypeScript**, strip-only. Explicit `.ts` on every relative import. No build step for
development; no runtime type information, so anything needing to *read* a type reads the source
([config/types.ts](config.md)).

## Generated, not written

Three things are derived rather than maintained, because hand-written documentation of a type is
wrong the week after it is written:

- the **config template** (`witness init`) — fields from the type declarations, provider names from
  the registries
- the **skill** — verbs from the CLI it is describing
- a run's **`README.md`** — the call tree, read back off the directories that produced it

Add a field or register a provider and all three follow. Change one by hand and it stops following.
