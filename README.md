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
taken by hand, and nothing anyone can rerun. With it, driving the app is a line in a description — and
**there is no test file to write**: the same declaration runs from a shell, from CI, and from an agent.

The repository and the directory are called `witness`; the package is `@burrows99/witness`, because a
GitHub Packages name is always scoped to the account that owns the repository — and because the unscoped
name is taken on npmjs.com.

## Table of Contents

- [The shape of it](#the-shape-of-it)
- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [Evidence](#evidence)
- [A worked example: Grafana, from nothing](#a-worked-example-grafana-from-nothing)
- [The conventions worth keeping](#the-conventions-worth-keeping)
- [Tests](#tests)
- [API](#api)
- [Maintainers](#maintainers)
- [Contributing](#contributing)
- [License](#license)

## The shape of it

Two surfaces, and knowing which one you are on is most of the value:

- **The command line is for state** — set it up, read it back, find out whether the thing is even
  running. Every command reports the whole exchange (request, response, statement, timing), because the
  caller usually cannot open a network tab. Most questions — *why is this empty*, *did that save* — are
  one command, and writing a test to answer them is how an afternoon disappears.
- **An action is for behaviour** — a sequence someone performs, declared in the config and run outright:
  `witness action run <name> [key=value…]` drives it in a browser and comes back with the frames, the
  debug story and the video. Chain several and they share one browser, one recording, and whatever each
  one stored.
- **There is no third thing.** An action composes other actions (`run`), narrates (`caption`, `slide`),
  asserts against the screen (`expect`) and against what the API answered or the database stored
  (`check`). Anything you would otherwise write as a program is steps in `.witness/config.jsonc`.
- **The description is data, and it is the point** — routes, requests, queries, sign-in flows and
  actions are declared once, and a description of a product outlives a suite about it.

A run leaves a **debug story** behind: `debug.md` and `debug.json`, with every request, console message
and uncaught error tagged with the step that was running when it happened. Playwright's trace is still
the debugger for a person; this is the version a program can read without opening a GUI.

```bash
witness init                    # .witness/{config.jsonc, SKILL.md, .gitignore}
witness skill                   # how to use it, generated from what this copy can do
witness stack status            # is it up, and is what is answering ours
witness api get /v1/whatever    # read the real payload before theorising about it
witness action list             # what this description says the product can do
EVIDENCE=before witness action run signIn checkout    # …change something… then EVIDENCE=after
```

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
npx witness init                               # writes .witness/ — a config, a runner, a skill, an entry point
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
    SKILL.md                  how to use this, generated — `witness skill` rewrites it
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

  // What a person sees: routes become screens, and one sign-in flow serves every action.
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
  "evidence": { "dir": "artifacts", "links": ["- the app: {web}"] }
}
```

### Writing an action

An action is the sequence, its narration and its claims — all of it data:

```jsonc
"customer.refundAnOrder": {
  "summary": "cancel an order and check the refund really landed",
  "app": "customer",
  "inputs": ["orderId"],
  "steps": [
    { "slide": { "title": "Refunding an order", "lines": ["What the customer sees, and what the API says."] } },
    { "run": { "action": "customer.signIn", "with": { "email": "{email}" } } },
    { "goto": { "route": "order", "params": { "orderId": "{orderId}" } } },
    { "click": { "role": "button", "name": "Cancel order" } },
    { "expect": { "on": { "text": "Refund on its way" }, "because": "the customer is told, not just the ledger" } },
    { "frame": "the order, cancelled" },

    { "api": { "operation": "orders.show", "params": { "orderId": "{orderId}" }, "as": "order" } },
    { "check": { "that": "{order.status}", "equals": "REFUNDED", "because": "the screen and the API must agree" } },
    { "query": { "name": "order.status", "as": "stored" } },
    { "check": { "that": "{stored}", "contains": "REFUNDED", "because": "and so must what was written down" } }
  ]
}
```

`witness action run customer.refundAnOrder orderId=1234` drives it and comes back with a frame per
step, the network with bodies, the console, a debug story and an MP4. `run` composes the small actions
into big ones without making either less usable on its own; `expect` is about the screen and `check` is
about the values, which is what makes the cross-layer claim expressible without a program.

**The dividing line that keeps this honest: a route, a request, a query or a click is data; a program is
a program.** A third party's client and a stub server stay as code, attached with `use()`. Config that
tries to encode a program has only moved the program somewhere worse — but a sequence, its narration and
its assertions are not a program, which is why none of the above is one.

The same system is importable when a project genuinely needs code (`System.find()`, `app.run`,
`app.api.call`, `app.db.query`, `app.evidence()`); nothing here requires it.

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
npx witness action show app.signIn     # its steps, as declared
npx witness action run app.signIn email=ada@example.com password=…
                                       # …and drive it, in a browser, with a video at the end
EVIDENCE=before npx witness action run app.checkout   # record a "before" cut
npx witness video                      # rebuild the MP4s from the last run
```

Every command reports the whole exchange — the request, the response, the statement, the timing — not
just the answer, because the caller is usually an agent that cannot open a network tab. Add `--quiet`
for the bare answer. Exit codes are the POSIX ones: `0` it worked, `1` it ran and failed, `2` you asked
for something that does not exist.

## Evidence

Everything about one run lands in one directory, named for what was run rather than by hand:

```
.witness/artifacts/cli/<the actions you ran>/<cut>/
  video.mp4                       the recording
  frames/01-her-dashboard.png     the stills a `frame` step named, in the order they were taken
  actions/<action>/01-click.png   a frame per step of every action the run went through
  actions/<action>/debug.md       what happened, with the network and console tied to each step
```

`<cut>` is `before`, `after` or `run` (`EVIDENCE=before`), so the two halves of a before/after cannot
overwrite each other and sit side by side for comparison. Several recordings from one run are stitched
into panels of one frame — two or three side by side, four or more into a grid — and `slide` steps are
spliced into the timeline as full-frame cards, so the video opens on what it means to show.

### The debug story

Every action also writes `actions/<action>/debug.md` and `debug.json` — what happened, told once, in the
order someone debugging would want it:

```md
# customer.cancelOrder — failed at step 3 of 5 (8.4s)

## What it was doing
1. ✓ `goto` /orders/1 — 412ms · actions/customer.cancelOrder/01-goto.png
2. ✓ `click` role=button name=Cancel — 180ms · …
3. ✗ `expect` text=Cancelled — 30.0s · …

## Where it broke
**During that step:** 3 requests, **1 of them failed** · the console said 1 thing worth reading
**POST /api/orders/1/cancel** → 500 (412ms) during `click Cancel`
  Sent:       {"reason":null}
  Came back:  {"message":"reason is required"}
> `error` Cannot read properties of undefined (reading 'id') — app.js:12

## Network (17 requests · 1 failed · 2 over a second)  …table…
## Console · ## Uncaught in the page · ## What the harness itself did
## Where to look
- everything, in the trace viewer: `npx playwright show-trace …/trace.zip`
```

The point is the **correlation**: every request, log and exception is tagged with the step that was
running when it happened. "A 500 came back" is not a diagnosis; "the 500 came back during `click Cancel`,
and the console error a tick later says the reducer got undefined" is one — and that is the join a person
does by hand across three panes, which an agent reading a filesystem cannot do at all.

**This does not reimplement the tools.** All of it is recorded through Playwright's own page events —
`request`, `response`, `requestfailed`, `console`, `pageerror` — and written down beside the run. The
story is what a *program* reads; Playwright's trace is what a *person* opens, and the story names it
rather than replacing it.

## A worked example: Grafana, from nothing

Everything below is real and reproducible — the repo is [`examples/grafana/`](examples/grafana). Grafana
is somebody else's software, chosen because neither this tool nor its author has any say over it.

```bash
docker run -d --name witness-example-grafana -p 3010:3000 grafana/grafana
npx witness init                                   # writes .witness/{config.jsonc, SKILL.md, .gitignore}
#   …describe the product: services, api, routes, locators, actions — one file, below…
GRAFANA_USER=admin GRAFANA_PASSWORD=admin \
  npx witness action run grafana.theWholeProduct username=admin password=admin
```

<video src="https://github.com/burrows99/witness/raw/main/docs/example/grafana.mp4" controls width="760"></video>

![Signing in to Grafana and walking the whole of it, narrated](docs/example/grafana.gif)

*(the [MP4](docs/example/grafana.mp4) is what the run actually produced; the GIF above is it, for GitHub)*

### What produced it

One action, declared as data. No test file, no page objects, no code — it composes seven smaller
actions, each of which still runs on its own:

```jsonc
"grafana.theWholeProduct": {
  "summary": "the whole of a fresh Grafana, walked once, and checked against its own API as it goes",
  "app": "grafana",
  "inputs": ["username", "password"],
  "steps": [
    { "slide": { "title": "Grafana, described", "lines": ["One config file: services, API operations, routes, locators, actions.", "There is no test file. This IS the description."] } },
    { "run": { "action": "grafana.signIn", "with": { "username": "{username}", "password": "{password}" } } },
    { "frame": "signed in" },

    { "api": { "operation": "stats", "as": "stats" }, "note": "what the instance says about itself, before looking at a single screen" },
    { "slide": { "title": "What it says it holds", "lines": ["{stats.dashboards} dashboards · {stats.datasources} data sources · {stats.users} user"] } },

    { "run": "grafana.openDashboards" },
    { "frame": "dashboards, empty" },
    { "api": { "operation": "search", "as": "listed" } },
    { "check": { "that": "{listed.length}", "equals": "{stats.dashboards}", "because": "the API and the screen should agree about how many dashboards there are" } },

    { "caption": { "text": "What it could connect to", "sub": "Searching the catalogue the way a person would." } },
    { "run": { "action": "grafana.browseConnections", "with": { "search": "prometheus" } } },
    { "check": { "that": "{offered.length}", "atLeast": 1, "because": "searching the catalogue for prometheus should offer something" } },
    { "frame": "the connection catalogue" }
    // …explore, data sources, users, profile
  ],
  // The note a person re-walks it by. Every value is a template, so it says what THIS run saw.
  "verify": {
    "title": "What a fresh Grafana is",
    "subject": { "instance": "http://localhost:3010", "account": "{username}", "dashboards": "{stats.dashboards}" },
    "signIn": ["docker run -d --name witness-example-grafana -p 3010:3000 grafana/grafana"],
    "notes": ["The catalogue offered {offered.length} matches for \"prometheus\" — see the frame."]
  }
}
```

and one of the seven it is built from:

```jsonc
"grafana.signIn": {
  "summary": "sign in the way a first-time admin does, and get past the password prompt",
  "app": "grafana",
  "inputs": ["username", "password"],
  "steps": [
    { "goto": { "route": "login" } },
    { "type": { "on": { "placeholder": "email or username" }, "value": "{username}" } },
    { "type": { "on": { "placeholder": "password" }, "value": "{password}" }, "note": "typed, not filled: this gets recorded" },
    { "click": { "role": "button", "name": "Log in" } },
    { "click": { "role": "button", "name": "Skip", "exact": true }, "note": "Grafana renders Skip as a button styled as a link — the frame said so" },
    { "waitForUrl": { "url": "localhost:3010/(\\?.*)?$", "timeout": 15000 } },
    { "expect": { "on": { "text": "Welcome to Grafana" }, "because": "the home page greets a signed-in admin" } }
  ]
}
```

Four of those lines are there because a run told me so. `Skip` is a `button` that looks like a link —
the frame from the failing step showed it. The home page's heading is "Good evening", not a fixed
greeting, so the assertion moved to the line underneath it. The plugin search placeholder and the
empty-dashboard wording are 13.2's, and both were read off a frame rather than out of Grafana's source.
Every one was a one-line edit to the description.

The two `check` steps are the part that used to need a program: `expect` can only see the screen, and
*the API says one dashboard and the list shows one dashboard* is a claim about two layers at once.

### What came back

```
.witness/artifacts/cli/grafana-thewholeproduct/run/
  video.mp4                                     ← the recording above
  frames/01-signed-in.png … 08-….png            the stills the `frame` steps named, in order
  actions/grafana-thewholeproduct/01-slide.png … 26-frame.png    a frame per step
  actions/grafana-thewholeproduct/debug.md      ← the story, below
  actions/grafana-thewholeproduct/debug.json    the same thing for a program to read
  actions/grafana-signin/…                      one directory per action it composed
  actions/grafana-browseconnections/…
  manual-verification.md                        what the action's `verify` said, filled in
```

[`debug.md`](docs/example/debug.md), in full — generated, not written:

```md
# grafana.theWholeProduct — ok (32.2s)

## What it was doing
 1. ✓ `slide` Grafana, described — 5.2s · actions/grafana-thewholeproduct/01-slide.png
 2. ✓ `run` grafana.signIn — 2.7s · …/02-run.png
 3. ✓ `frame` signed in — 60ms · …/03-frame.png
 4. ✓ `api` what the instance says about itself, before looking at a single screen — 33ms · …
 5. ✓ `slide` What it says it holds — 5.2s · …
 6. ✓ `run` grafana.openDashboards — 1.0s · …
 8. ✓ `api` search — 42ms · …
 9. ✓ `check` the API and the screen should agree about how many dashboards there are — 23ms · …
…
26. ✓ `frame` the admin's own page — 50ms · …/26-frame.png

## Network (500 requests · 3 failed · 42 over a second)
_172 more were not recorded: the run passed the limit._

| at | step | method | status | ms | url |
|---|---|---|---|---|---|
| 5.3s | run grafana.signIn | GET | 200 | 24ms | http://localhost:3010/login |
| 7.0s | run grafana.signIn | POST | 200 | 14ms | http://localhost:3010/login |
| 16.1s | run grafana.browseConnections | GET | 200 | 61ms | http://localhost:3010/api/plugins?… |
…and 300 static assets (scripts, styles, fonts, images).

## Console · ## Uncaught in the page

## What the harness itself did
- `GET http://localhost:3010/api/admin/stats` → 200 (30ms) · stats
- `GET http://localhost:3010/api/search` → 200 (11ms) · search

## Where to look
- the recording: `video.mp4`
- the frames: `frames`
- everything, in the trace viewer:
  `npx playwright show-trace .witness/artifacts/test-results/cli-grafana-thewholeproduct/trace.zip`
```

Every request is tagged with the **step** that was running when it happened — that join is the thing an
agent cannot do from a trace file, a video or an HTML report, and it is why this file exists. When a
step fails, the same file gains a "Where it broke" section: the error, the frame from that moment, and
what the page was doing during that step.

And the same description answers questions without a browser at all:

```bash
$ npx witness stack status
grafana  http://localhost:3010    up       witness-example-grafana

$ npx witness api get /api/health --quiet
{ "database": "ok", "version": "13.2.0", "commit": "f681b1359f6a0b8ecb9f2c49a88ac72b75bde73b" }
```

## The conventions worth keeping

These are not the tool's rules — they are what makes the output worth anything.

- **Drive the real app.** Set the world up through its own API or UI. A row written by hand is a row the
  app never agreed to, and a test built on one passes for the wrong reason.
- **Assert at the right layer.** The screen is evidence of what rendered; the API of what it answered;
  the database of what was stored. Pick the one the claim is actually about.
- **Read the running container, not the file it was built from.** They disagree the moment someone edits
  without recreating, and the process serving requests is the one telling the truth.
- **Seed only what no endpoint can create,** and say in a comment which step consumes it.
- **Narrate.** A recording nobody can follow is not evidence. A `caption` before each action and a
  `slide` before each section cost one line each and are the difference between a video and a artefact.
- **Say why in the claim.** `because` on an `expect` or a `check` becomes the failure message, which is
  the only sentence anyone reads when it breaks.
- **Leave the note.** An action's `verify` writes `manual-verification.md` — filled with what this run
  saw — which turns "it passed" into something a reviewer can check themselves.

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
| `Evidence` | Frames, files and notes, filed under `cli/<what was run>/<cut>` — derived, never named by hand. |
| `Trace` | Everything the harness sent and ran, with bodies. What a caller gets back instead of a boolean. |
| `Inspector` | The network, the console and the uncaught errors — each tagged with the step it happened during. |
| `Story` | All of that written up as `debug.md` / `debug.json`, pointing at the trace and the video. |
| `Skill` | The instructions for whoever drives it — generated from the commands, the step verbs and the config's own types. |
| `StubServer` | A declared stand-in for a third party the app calls server-side, with its state and its request log. |
| `Cli` | A git-style command line (`<tool> <noun> <verb>`) with `stack`/`api`/`db`/`action`/`video` built in. |

### Providers

Everything that meets the outside world is a provider the config picks **by name**, so a second way of
doing any of them is a registration rather than an edit. An unknown name fails with the list of what IS
registered.

| Kind | Registered today | Where |
|---|---|---|
| client | `rest`, `graphql` | `src/providers/clients.ts` |
| auth | `apiKey`, `bearer`, `basic`, `cookie`, `login` | `src/providers/auth.ts` |
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
