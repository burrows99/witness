# witness _(@burrows99/witness)_

[![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)
[![release](https://img.shields.io/github/v/release/burrows99/witness?style=flat-square)](https://github.com/burrows99/witness/releases)
[![node](https://img.shields.io/badge/node-%3E%3D22.6-brightgreen?style=flat-square)](https://nodejs.org)
[![tests](https://img.shields.io/github/actions/workflow/status/burrows99/witness/tests.yml?branch=main&style=flat-square&label=tests)](https://github.com/burrows99/witness/actions/workflows/tests.yml)
[![license](https://img.shields.io/github/license/burrows99/witness?style=flat-square)](LICENSE)

Drive a running system from one config file, and come back with evidence rather than a pass/fail.

Drive an app **against the real thing it runs as** — the containers on this machine, the database behind
them, the browser in front of them — and get back the requests with their bodies, a frame per step, a
video, and a note a person can follow to check it themselves.

It knows nothing about any particular product. You describe yours in one directory — `.witness/`, in the
root of your project — and hand it over: `System.find()`. A route, a request, a query, a click, a
sign-in flow and a stand-in for a third party are all data; what a config cannot honestly express stays
code, attached by name.

It exists because the same problem keeps being solved badly: an agent (or a person) changes some code
and then needs to *see it work*. Without this, that means throwaway curl, ad-hoc psql, a screenshot
taken by hand, and nothing anyone can rerun. With it, driving the app is a call — and the same call
works from a spec, from a shell, and from an agent.

The repository and the directory are called `witness`; the package is `@burrows99/witness`, because a
GitHub Packages name is always scoped to the account that owns the repository — and because the unscoped
name is taken on npmjs.com.

## Table of Contents

- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [Evidence](#evidence)
- [The conventions worth keeping](#the-conventions-worth-keeping)
- [Tests](#tests)
- [API](#api)
- [Maintainers](#maintainers)
- [Contributing](#contributing)
- [License](#license)

## Background

Test frameworks answer "did it pass". That is the wrong answer when the reader is reviewing a change:
what they need is what the app *did* — the request that 400'd next to the body that caused it, the
screen at the moment the thing appeared, the row as it was actually stored.

Everything a system like this needs to know that differs between products is the same short list —
where the services are, what the API can do, what the queries are, which routes a person visits, how
someone is signed in — so witness reads that list from a JSON file instead of being subclassed. What is
left is a small set of classes that know nothing about your product, and one directory in it that knows
nothing about them.

The pieces do not depend on each other: use `Stack` alone to find a local service, or all of it to drive
a flow end to end and come back with a video.

## Install

Published to **GitHub Packages**, the registry that belongs to this repository. Point your project at it
once — `.npmrc`, beside your `package.json`:

```
@burrows99:registry=https://npm.pkg.github.com
```

```bash
npm install --save-dev @burrows99/witness      # or pnpm add -D / yarn add -D
npx witness init                               # writes .witness/{config.jsonc, app.ts, .gitignore}
```

**GitHub Packages asks for a token even when the package is public** — that is the npm registry's
behaviour, not a setting on this package ([the container registry allows anonymous pulls; the npm one
does not](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages)).
Any GitHub token with `read:packages` will do, and it is the same line every consumer of a GitHub
Packages dependency needs:

```bash
npm config set //npm.pkg.github.com/:_authToken $YOUR_GITHUB_TOKEN     # or put it in ~/.npmrc
```

In CI, `${{ secrets.GITHUB_TOKEN }}` already has it — no secret to create.

Installing straight from git works too, and needs no token at all:

```bash
npm install --save-dev github:burrows99/witness
```

### Dependencies

- **Node 22.6+** — the sources are TypeScript, and the package ships both the build and the sources.
- **Docker** — for anything that reads a container's environment or its database. Not needed to drive a
  browser or an HTTP API.
- **[Playwright](https://playwright.dev)** — an optional peer dependency, needed for the browser half
  (`WebApp`, `Screen`, actions, narration, evidence). Install it yourself: `npm i -D @playwright/test`.
- **ffmpeg** — optional, and only to turn a run's recordings into MP4s.

### Updating

```bash
npm update @burrows99/witness
npx witness config template > .witness/config.jsonc.new    # the full surface of the new version
```

Every merge to `main` publishes a release and a package version, so `@latest` is whatever `main` is.

The template is generated from the type declarations of the copy that prints it, so it always describes
the version you have rather than the version somebody documented.

## Usage

```
your-project/
  .env                        the ports and container names compose reads
  docker-compose.yml
  .witness/
    config.jsonc              the description of this product
    app.ts                    `export const app = System.find()` — what specs import
    specs/                    what it can prove
    stubs/                    pages the declared stand-ins serve
    artifacts/                what runs leave behind — ignored by the .gitignore beside it
```

**Everything witness reads and writes is under that one directory**, and a relative path in the config
resolves against it. The exception is deliberate: the `.env` the stack is resolved from, and a secret's
`envFile`, belong to the checkout — they are not witness's to own, and they are shared with whatever
else the project runs.

### How the directory is found

The same way git finds a repository: walk up from the working directory and take the **first** one.
Nearest wins, so a package inside a monorepo gets its own and a worktree gets the copy in the worktree;
nothing is inherited from a parent, because an ambiguous answer here is worse than no answer. The order
is fixed, and asking is free:

| | |
|---|---|
| `--config <file>` | an explicit file, for a project that keeps its description elsewhere |
| `WITNESS_CONFIG` | the same, from the environment |
| `WITNESS_DIR` | a directory to use instead of the one that would be found |
| `.witness/` | the nearest one above the working directory |

```bash
npx witness config where    # which description is in force here, and why
```

`.witness/config.jsonc` is preferred over `.witness/config.json`; the directory names its own checkout,
so a project using the convention declares no `root` markers. A description kept somewhere else cannot
name a checkout, so that layout keeps finding it by walking up for the markers its config declares —
which is why `--config` stays a first-class way to run.

### The description

`witness init` writes one generated from the types, with every field documented. Cut down to what one
product actually uses, it reads like this:

```jsonc
{
  "name": "acme",

  // Ports and container names come from the same `.env` compose reads, so a second checkout
  // (a worktree with its own ports) needs no wrapper script. `kind` says whose software it is: a third
  // party is not restartable, not resettable, and the likeliest source of a flake that is nobody's fault.
  "services": {
    "web": { "kind": "in-house", "port": 3000, "portVar": "WEB_PORT", "container": "acme-web" },
    "api": { "kind": "in-house", "port": 8080, "portVar": "API_PORT", "container": "acme-api" },
    "postgres": { "kind": "in-house", "port": 5432, "container": "acme-postgres", "probe": "container" },
    "billing": { "kind": "third-party", "url": "https://api.sandbox.billing.example" }
  },

  // Every request it can make. Auth is named, and a value can come out of a running container.
  "api": {
    "service": "api",
    "auth": { "service": { "provider": "apiKey", "header": "x-api-key",
                           "from": { "containerEnv": { "service": "api", "key": "ADMIN_KEY" } } } },
    "operations": {
      "orders.show": { "path": "/v1/orders/{orderId}", "auth": "service" },
      "orders.cancel": { "method": "POST", "path": "/v1/orders/{orderId}/cancel", "auth": "service" }
    }
  },

  // What a person sees: routes become screens, and one sign-in flow serves every spec.
  "apps": {
    "customer": {
      "service": "web",
      "routes": { "dashboard": "/", "order": "/orders/{orderId}" },
      "signIn": { "mint": "auth.impersonate", "tokenParam": "token", "landing": "/auth/callback" }
    }
  },

  // What it can DO: a sequence of steps, with everything they touch declared.
  "actions": {
    "customer.cancelOrder": {
      "app": "customer",
      "inputs": ["orderId"],
      "steps": [
        { "goto": { "route": "order", "params": { "orderId": "{orderId}" } } },
        { "click": { "role": "button", "name": "Cancel order" } },
        { "expect": { "on": { "text": "Cancelled" }, "because": "the order should show as cancelled" } },
        { "query": { "name": "order.status", "as": "status" } }
      ],
      "returns": "{status}"
    }
  },

  "database": { "service": "postgres", "user": "acme", "database": "acme", "password": "acme",
                "queries": { "order.status": "select status from orders where id = '{orderId}'" } },
  "cast": { "REGULAR": { "id": "…", "why": "the only account with a saved card" } },
  "cli": { "order": { "verbs": { "show": { "operation": "orders.show", "args": ["orderId"] } } } },
  // Paths are relative to `.witness/`, and these are the defaults — a config that keeps them says nothing.
  "video": { "provider": "ffmpeg", "from": "artifacts/test-results", "out": "artifacts" },
  "evidence": { "dir": "artifacts", "links": ["- the app: {web}"] },
  "runner": { "test": { "command": "npx", "args": ["playwright", "test"] }, "env": { "WEB_URL": "{web}" } }
}
```

### From a spec

```ts
import { app } from "../app.ts";                          // `export const app = System.find()`

await app.customer.dashboard.open(page);                  // routes
await app.customer.order.open(page, { orderId });         // routes with arguments
await app.customer.signIn!(page, id);                     // the declared sign-in
await app.api.call("orders.cancel", { orderId });         // operations
app.db.query("order.status", { orderId });                // queries

const run = await app.run("customer.cancelOrder", page, { orderId });
run.steps;        // each step, its timing, and a frame captured after it
run.network;      // every request the BROWSER made while it ran
run.trace;        // every request and statement the HARNESS made, with bodies
```

**The dividing line that keeps this honest: a route, a request, a query or a click is data; a program is
a program.** A third party's client and a stub server stay as code, attached with `use()`. Config that
tries to encode a program has only moved the program somewhere worse.

### CLI

The config above gives you all of this, with no entry point to write:

```bash
npx witness init                       # make a .witness/ here
npx witness config where               # which description is in force, and why
npx witness config template            # every field this version understands, documented
npx witness stack status               # what is up, on which ports, from which checkout
npx witness api get /v1/health         # any route, authenticated the way the config says
npx witness db sql "select 1"          # the stack's database
npx witness order show 1234            # the verbs the config declares
npx witness action list                # what the product can DO
npx witness test --before              # the suite, recording a "before" cut
npx witness video                      # rebuild the MP4s from the last run
```

Every command reports the whole exchange — the request, the response, the statement, the timing — not
just the answer, because the caller is usually an agent that cannot open a network tab. Add `--quiet`
for the bare answer. Exit codes are the POSIX ones: `0` it worked, `1` it ran and failed, `2` you asked
for something that does not exist.

## Evidence

Everything about one test lands in one directory, named for the test rather than by hand:

```
.witness/artifacts/<spec>/<test>/<cut>/
  video.mp4                       the recording
  frames/01-her-dashboard.png     stills, numbered in the order they were taken
  actions/<action>/01-click.png   a frame per step of each action the test ran
  manual-verification.md          how to re-walk it by hand
```

`<cut>` is `before`, `after` or `run`, so the two halves of a before/after cannot overwrite each other
and sit side by side for comparison. Several recordings from one test are stitched into panels of one
frame — two or three side by side, four or more into a grid — and slides a spec marked are spliced into
the timeline as full-frame cards, so the video opens on what it means to show.

## The conventions worth keeping

These are not the tool's rules — they are what makes the output worth anything.

- **Drive the real app.** Set the world up through its own API or UI. A row written by hand is a row the
  app never agreed to, and a test built on one passes for the wrong reason.
- **Assert at the right layer.** The screen is evidence of what rendered; the API of what it answered;
  the database of what was stored. Pick the one the claim is actually about.
- **Read the running container, not the file it was built from.** They disagree the moment someone edits
  without recreating, and the process serving requests is the one telling the truth.
- **Seed only what no endpoint can create,** and say in a comment which step consumes it.
- **Narrate.** A recording nobody can follow is not evidence. Caption before each action.
- **Leave the note.** `Evidence.manualVerification()` turns "it passed" into something a reviewer can
  check themselves — written whether the run passed or failed, because a failure is when someone looks.

## Tests

Beside the file they test, run by Node's own test runner:

```bash
npm test        # node --test "src/**/*.test.ts" "bin/**/*.test.ts"
```

No framework, no config, nothing to install: the unit tests drive the real thing with the outside world
handed in — a docker whose output the test wrote, a page that records what it was asked to do, a stub
server on a real port. The parts that need Playwright skip themselves where it is not installed, so this
runs in a bare checkout too.

## API

| Class | What it is |
|---|---|
| `System` | `System.find()` — assembles everything below from the description in `.witness/`. The entry point. |
| `Workspace` | `.witness/` — the one directory this tool reads and writes, found by walking up from where you are. |
| `Stack` | Where the services are. Reads the **same `.env` compose reads**, so a second checkout needs no wrapper script. |
| `Docker` | `exec` into a container, read its env, list what is running, say who holds a port. |
| `HttpApi` | A base URL, auth headers, JSON in/out, and an error that names the request. |
| `Operations` | Every request the product can make, by name, from the config. |
| `Postgres` | `sql()` / `rows()` through `docker exec psql` — no driver, no pool. |
| `Queries` | Every SQL statement worth naming, from the config. |
| `WebApp` | Where an app is in the browser; `Screen` is one page of it. |
| `Actions` | What the product can DO — step lists in the config, each returning its own evidence. |
| `SignIn` | Magic-link sign-in, described: mint → land → exchange → optional post-inject queries. |
| `Evidence` | Frames, files and notes, filed under `<spec>/<test>/<cut>` — derived, never named by hand. |
| `Trace` | Everything the harness sent and ran, with bodies. What a caller gets back instead of a boolean. |
| `StubServer` | A declared stand-in for a third party the app calls server-side, with its state and its request log. |
| `Cli` | A git-style command line (`<tool> <noun> <verb>`) with `stack`/`api`/`db`/`test`/`video` built in. |

### Providers

Everything that meets the outside world is a provider the config picks **by name**, so a second way of
doing any of them is a registration rather than an edit. An unknown name fails with the list of what IS
registered.

| Kind | Registered today | Where |
|---|---|---|
| client | `rest`, `graphql` | `src/providers/clients.ts` |
| auth | `apiKey`, `bearer`, `cookie`, `login` | `src/providers/auth.ts` |
| secret | `containerEnv`, `envFile`, `env`, `literal` | `src/providers/secrets.ts` |
| video | `ffmpeg` | `src/providers/video.ts` |
| stub | `http` | `src/providers/stubs.ts` |

## Maintainers

[@burrows99](https://github.com/burrows99)

## Contributing

Issues and pull requests are welcome: [open an issue](https://github.com/burrows99/witness/issues) for a
question, a bug, or something that surprised you.

Before a pull request:

```bash
npm install
npm test          # no framework, and nothing to configure
npm run typecheck
```

What the codebase asks of a change:

- **A test beside the file it tests** (`src/thing.ts` → `src/thing.test.ts`), driving the real thing with
  the outside world handed in rather than mocking the module next door.
- **Explicit `.ts` extensions on every import** — the same files load under Node, under a test runner and
  from a package, and that is what makes it possible.
- **A comment that says why, not what.** The reason a line exists is the thing a reader cannot recover.
- No new runtime dependencies. Playwright is an optional peer, and there is nothing else.

## License

MIT © 2026 burrows99

See [LICENSE](LICENSE).
