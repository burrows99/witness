# witness _(@macquery-labs/witness)_

[![ci](https://github.com/macquery-labs/witness/actions/workflows/ci.yml/badge.svg)](https://github.com/macquery-labs/witness/actions/workflows/ci.yml)
[![codeql](https://github.com/macquery-labs/witness/actions/workflows/codeql.yml/badge.svg)](https://github.com/macquery-labs/witness/actions/workflows/codeql.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg)](https://github.com/RichardLitt/standard-readme)

A CI gate that blocks a merge when changed code was never executed.

**Coding agents change code and declare it done without ever running it.** `witness` moves the
check to the only layer that is both universal and binding: CI. A run produces one artefact — a
**story**, a causally ordered timeline of what was driven and what happened across browser, server
and database. CI re-checks that story against the diff it claims to verify, and blocks the merge if
the changed code was never exercised, the evidence is stale, or the assertions failed.

Because the gate reads a diff and a JSON file, it works with any vendor's agent, with several at
once, or with none.

The binary is `witness`; the package that installs it is `@macquery-labs/witness`, because the
GitHub Packages namespace for a scoped package is the owning organisation.

```console
$ witness init
wrote .witness/config.json

$ witness plan --intent "checkout applies the tiered discount" --scope 'src/pricing/**'
wrote .witness/plans/checkout-applies-the-tiered.plan.json  (1 step, 1 assertion)
# edit the plan, commit it with your change

$ witness verify --plan checkout-applies-the-tiered
  probes     12 logpoint(s) on 12 changed line(s)   [12 verified]
  coverage   10/12 exercised
  assertions 2/2 passed
  story      .witness/runs/01M0TZ.../story.json  (47 events)

witness: BLOCK — 2 errors
  SV010  src/pricing/discount.ts:41  changed line never executed: src/pricing/discount.ts:41
         → Add a step to plan "checkout" that reaches src/pricing/discount.ts:41, or waive it with a dated reason.
  SV010  src/pricing/discount.ts:42  changed line never executed: src/pricing/discount.ts:42
         → Add a step to plan "checkout" that reaches src/pricing/discount.ts:42, or waive it with a dated reason.
  coverage   10/12 changed lines exercised
  assertions 2/2 passed

exit 2
```

---

## Table of Contents

- [Background](#background)
- [Install](#install)
  - [Dependencies](#dependencies)
- [Usage](#usage)
  - [CLI](#cli)
  - [GitHub Actions](#github-actions)
- [Exit codes](#exit-codes)
- [Findings](#findings)
- [Measured, every run](#measured-every-run)
- [Static analysis](#static-analysis)
- [Test tiers](#test-tiers)
- [What is supported](#what-is-supported)
- [Telling an agent how to work here](#telling-an-agent-how-to-work-here)
- [Free by default](#free-by-default)
- [Not yet built](#not-yet-built)
- [Repository layout](#repository-layout)
- [API](#api)
- [Maintainers](#maintainers)
- [Contributing](#contributing)
- [License](#license)

## Background

Four moving parts, in the order they run:

1. **Plan** — committed, reviewable, declares intent and scope. A reviewer can push back on what the
   change *intends* to prove before looking at whether it went green.
2. **Instrumentation** — the diff decides where probes go. No human and no agent picks lines.
3. **Run** — a driver acts, probes observe, recorders capture. One story comes out.
4. **Gate** — a pure function turns story + diff into a verdict.

Probes are **DAP logpoints**, not breakpoints. The Debug Adapter Protocol is explicit that when
`logMessage` is set the adapter must log rather than break — which is the only way to observe a
request without suspending the server that is serving it.

One `traceparent` threads browser → server → data, so the harness correlates evidence at capture
time. The agent never correlates by timestamp.

## Install

The package lives on this repository's own npm registry, so npm needs to be told
where the scope comes from once:

```
@macquery-labs:registry=https://npm.pkg.github.com
```

in your `.npmrc`, then:

```bash
npm install -g @macquery-labs/witness
witness doctor
```

Node 22 or newer is required.

### Dependencies

`doctor` reports which languages this machine can instrument. Python and Go need
no setup beyond `debugpy` and `dlv`; JavaScript and TypeScript need js-debug,
which Microsoft ships only as a release asset:

```bash
mkdir -p ~/.witness/adapters
gh release download --repo microsoft/vscode-js-debug \
  --pattern 'js-debug-dap-*.tar.gz' -O - | tar xz -C ~/.witness/adapters
```

## Usage

Three commands cover the loop: describe what the change should prove, run it, and read the verdict.

```bash
witness init                                             # scaffold .witness/config.json
witness plan --intent "..." --scope 'src/pricing/**'     # emit a plan skeleton, then edit it
witness verify --plan checkout-applies-the-tiered        # run + gate in one step
```

The plan is committed alongside the change it describes, so a reviewer can argue with the intent
before looking at whether it went green. `verify` exits non-zero when the changed code was never
exercised — see [Exit codes](#exit-codes).

### CLI

```console
$ witness --help
  witness init [--agents] [--hooks]               scaffold config, AGENTS.md, hooks
  witness plan   --intent <s> --scope <glob>...   emit a plan skeleton
  witness run    --plan <path> [--record]         execute, emit story (and film it)
  witness gate   --run <id> | --story <path>      evaluate, publish
  witness verify --plan <path>                    run + gate (one command)
  witness show   --run <id> [--open]              render viewer
  witness skill  [--out <path>] [--check]         generate this project's agent skill
  witness doctor                                  adapters, ports, path mappings
```

Common flags: `--json` for machine-readable output on stdout and nothing else, `--vcs <name>` to
pick the host provider, `--base <ref>` to choose what the diff is taken against, `--bypass <why>`
to record a reasoned bypass, and `--cwd <path>` to run against another working directory.

`witness run --record` films the run; `witness show --run <id> --open` renders the story as one
self-contained HTML file.

### GitHub Actions

`gate` evaluates a story an earlier job produced; `verify` runs the plan first.

```yaml
- uses: macquery-labs/witness@v0
  with:
    command: gate
    story: .witness/runs/${{ github.run_id }}/story.json
    # warn-only: true   # report findings without failing the job, for a staged rollout
```

Outputs are `verdict` (`allow` | `block` | `bypass`), `exit-code`, and `findings` — the full
`GateResult` as JSON.

## Exit codes

| Exit | Meaning | CI reads it as |
|---|---|---|
| 0 | allow | green |
| 2 | block — an error-severity finding | red, developer's problem |
| 3 | usage / config error | red, config problem |
| 4 | **harness failure** — fixture down, adapter crash, port collision | red, *our* problem |
| 5 | bypassed, recorded | amber |

**4 is deliberately distinct from 2.** "Your change is unverified" and "our debugger failed to
attach" produce identical frustration if they share a code, and the second is the failure this
project will hit most in its first six months. It also keeps the catch-rate arithmetic honest: a
harness crash is not a catch.

## Findings

Every finding carries a `remedy`, not just a message. A gate that says "line 41 never executed" and
stops has handed the developer a research task.

| Code | Meaning |
|---|---|
| `SV001` | no story for this change |
| `SV002` | story fails schema validation |
| `SV003` | `diff_hash` mismatch — stale evidence |
| `SV004` | story ran a different plan than the one in the tree |
| `SV010` | changed line never executed |
| `SV011` | probe accepted but never verified (path mapping / unbound) |
| `SV012` | changed file not covered by any plan scope |
| `SV013` | waiver expired, or expiring |
| `SV014` | defensive line unexercised (policy: `off` \| `warn` \| `require`) |
| `SV015` | waivers exceed the configured cap on the diff |
| `SV016` | changed code in a language with no trustworthy adapter — not gated, and said so |
| `SV020` | assertion failed |
| `SV021` | plan has zero assertions |
| `SV030` | step produced no agent-readable artefact |
| `SV040` | breakpoint used in CI |
| `SV041` | run exceeded the time budget |
| `SV090` | gate bypassed — reason recorded |

`SV010` and `SV011` are separate on purpose. "The code never ran" and "we never actually watched it"
look identical and have opposite remedies; merging them is how a coverage gate silently stops
meaning anything.

## Measured, every run

The two numbers are only meaningful as a pair: catch rate alone is maximised by blocking
everything, and false-block rate alone is maximised by a gate that never fires.

| Metric | Definition | Target | Current |
|---|---|---|---|
| **M1** catch rate | injected bugs the gate blocks | ≥ 95% | **100%** (9/9) |
| **M2** false-block rate | harmless diffs the gate wrongly blocks | ≤ 2% | **0%** (0/5) |

Measured by the L3 mutation suite (`pnpm test:l3`) against a real Python service under real
debugpy logpoints: a broken cart total, an off-by-one paginator, a swallowed exception, a branch
no step reaches, a renamed response field, money rounded to the wrong unit. The null mutations are
comments, docstrings, reflowed whitespace, reordered imports, and an equivalent rewrite of a line
the plan does drive.

## Static analysis

Five layers, each earning its place by catching something the others cannot. `pnpm check` runs the
fast ones together.

| Layer | Catches | Command |
|---|---|---|
| `tsc --build` | type errors in shipped code | `pnpm typecheck` |
| `tsc -p tsconfig.eslint.json` | type errors in **tests**, which the build configs exclude | `pnpm typecheck:all` |
| ESLint + typescript-eslint, type-aware | floating promises, misused promises, non-exhaustive switches over the event union, unsafe `any` reaching a validated boundary | `pnpm lint` |
| knip | unused files, exports and dependencies across the workspace | `pnpm knip` |
| `pnpm audit` + CodeQL | vulnerable dependencies, security patterns | CI |

Two of these paid for themselves immediately. Type-checking the tests — which had never been
checked, because every `tsconfig.json` includes only `src/` — found two assertions that proved
nothing: `{ coverage: story.coverage, ...story }` looks like a reordering but the spread puts the key
straight back, so the "seal is independent of key order" test was vacuous. Both now reorder keys for
real, and both still pass. knip found a package declaring a dependency it never imported, and four
exports nothing consumed.

Style is deliberately not enforced. A formatter would rewrite six thousand lines to settle questions
that have never cost this project anything, and the diff would bury the next real change.

**What this setup does not catch:** an unused export that a barrel file re-exports. `knip
--include-entry-exports` reports those, but in a library monorepo `export * from './seal.js'` *is*
the public surface, and running it reports 61 legitimate API entries. It is a useful thing to read
occasionally and a bad thing to gate on.

## Test tiers

The pyramid is inverted on purpose: the risk is not "is the logic correct" but "does this work on
real, messy code".

| Tier | What | Command |
|---|---|---|
| **L0** unit | schema, `diff_hash`, coverage math, gate logic, redaction | `pnpm test:l0` |
| **L1** adapter contract | one tiny fixture app per language, same assertions, real adapters | `pnpm test:l1` |
| **L2** conformance | the CLI end to end against real apps and a real browser | `pnpm test:l2` |
| **L3** mutation | inject a known bug, assert the gate **blocks**; publish M1/M2 | `pnpm test:l3` |
| **L4** dogfood | witness gates its own change | `pnpm test:l4` |
| **arch** | dependency rules and workspace hygiene, enforced rather than reviewed | `pnpm test:arch` |

L3 is the tier that matters. A green suite proves the harness *ran*; it does not prove the harness
would have *caught* anything.

## What is supported

| Language | Adapter | Status |
|---|---|---|
| Python | debugpy | **working** — contract suite green against the real adapter |
| Go | delve | **working** — contract suite green against the real adapter |
| TypeScript / JavaScript | js-debug | declared, **not vendored in this build** |
| Java | java-debug | declared, **not vendored in this build** |

A language with no trustworthy adapter is refused, not degraded: `witness doctor` says which
adapters are present and what would fix the ones that are not. A gate that falls back to
log-scraping is flaky, and flaky gates get bypassed.

Drivers: `api` (HTTP) and `web` (Playwright). Fixtures: `process` (witness starts the app under
the debugger, on randomised ports) and `none` (attach to something already listening).

## Telling an agent how to work here

`witness skill` writes an [Agent Skills](https://agentskills.io) `SKILL.md` for the project it is
run in, derived from that project rather than written by hand:

```console
$ witness skill
wrote .claude/skills/verify-acme-checkout/SKILL.md
describes 3 plan(s): checkout, refunds, signup
regenerate whenever the project changes; `witness skill --check` fails in CI when it is stale
```

The generated file tells an agent which plan covers which paths and what each one intends to prove,
which languages this environment can actually instrument and what would fix the ones it cannot, the
findings it will meet and whether each blocks or only warns, and the coverage and bypass policies in
force. All of it comes from the config, the committed plans and the installed adapters, so adding a
plan or installing an adapter changes the skill the next time it is generated.

Two properties make that hold:

- **Generation is deterministic** — no timestamp, no random id — so "is this skill stale?" has an
  answer. The frontmatter carries a `witness-fingerprint` over the facts it was built from.
- **`witness skill --check` regenerates in memory and compares**, exiting 3 without writing
  anything if the file no longer matches the project. Run it in CI: steering that nobody enforces
  drifts, which is the same argument that puts the gate there.

Frontmatter stays inside the six fields the Agent Skills spec defines, so the file loads in
claude.ai and through the API as well as in Claude Code, which reject unknown keys. `--out` writes
it anywhere else you keep skills.

## Free by default

- No host, no token, no network. `--vcs local` passes the full suite, and the GitHub, GitLab and
  Bitbucket providers publish through workflow commands and env-provided event payloads — no API
  call in the free path.
- No database. The filesystem plus CI artifact storage is the entire persistence layer.
- **Redaction runs before an artefact reaches disk**, not before upload. A leaked token in a CI
  artifact has already leaked.

## Not yet built

Stated plainly, because a spec is not a shipped feature:

- **js-debug and java-debug are not vendored**, so this build cannot instrument TypeScript or Java.
  It refuses rather than pretending. That also means witness gates the parts of *itself* it can
  instrument (the Python and Go fixtures) rather than its own TypeScript.
- **`compose` fixtures** are declared in the plan schema and refused by the runner (exit 3).
- **OpenTelemetry collection** (`probe-otel`): boundary spans currently come from the drivers
  themselves, not from an app-side OTel pipeline.
- **The database and terminal recorders**, the cloud control plane, the evidence vault, flake
  detection and domain packs beyond `fullstack`.

## Repository layout

```
src/
  core/         story schema, diff_hash, coverage, gate, redaction, seal   (no I/O, ever)
  cli/          the binary — the only module that composes everything
  probe-dap/    DAP client, logpoints, adapter registry, path mapping
  driver-api/   HTTP driver, W3C trace context, HTTP assertions
  driver-web/   Playwright driver, a11y snapshots, ui-text assertion
  recorders/    the artefact store: redaction before disk, budget backpressure
  vcs/          VcsProvider: local, github, gitlab, bitbucket
  viewer/       the story viewer — one self-contained HTML file
  mcp/          MCP adapter over the CLI (no logic of its own)
action/         GitHub Action
fixtures/       per-language contract fixtures
test/           l2 conformance · l3 mutation · l4 dogfood · arch rules
```

One manifest, one published package: `@macquery-labs/witness`. The directories under `src/` are
module boundaries, not distribution units — a consumer installs the whole thing and gets the CLI on
their `PATH`, and the layout exists so the dependency rules below have something to be rules about.

Splitting them back into separate packages would buy independent versioning that nothing here wants
and cost a release matrix, nine changelogs, and the standing risk of publishing a set that does not
work together. The boundaries are worth keeping; the manifests were not.

Four dependency rules are enforced by `pnpm test:arch`, not by review:

1. `core` must not import drivers, probes or recorders — the gate runs in CI with no browser and no
   debugger installed.
2. `core` must not import `vcs` — it receives a resolved bypass as data and returns a verdict; it
   does not know what a pull request is.
3. No module may import the cloud control plane — otherwise the open core is a demo.
4. Redaction lives in `core`, because it has to run before disk, not before upload.

## API

The package ships the CLI as its main entry point, and exposes the gate as a library for anyone who
wants the verdict without the binary. Both entry points are ESM only.

```js
import { evaluate, storySchema, diffHash } from '@macquery-labs/witness'
import { run } from '@macquery-labs/witness/cli'
```

| Entry point | Contains |
|---|---|
| `@macquery-labs/witness` | `core` — the story schema, `diff_hash`, coverage math, ordering, redaction, seal, and `evaluate`, the pure story + diff → verdict function |
| `@macquery-labs/witness/cli` | `run` (the CLI as a function), `runPlan`, `assembleStory`, `parseArgs`, and the `EXIT` codes |

`core` performs no I/O and imports no driver, probe or recorder, so the gate runs in CI with no
browser and no debugger installed. That rule is enforced by `pnpm test:arch`, not by review.

## Maintainers

[@burrows99](https://github.com/burrows99)

## Contributing

Questions and bug reports go in [GitHub Issues](https://github.com/macquery-labs/witness/issues);
open-ended discussion goes in
[GitHub Discussions](https://github.com/macquery-labs/witness/discussions).

PRs are accepted. Before opening one:

- `pnpm check` must pass — typecheck, typecheck of the tests, lint, knip, L0 and the architecture
  rules. `pnpm test:l1` and `pnpm test:l2` need the adapters and a browser; `witness doctor` says
  what is missing.
- Commit the plan with the change it describes. This project gates itself (`pnpm test:l4`), so a
  change to instrumentable code that no plan reaches will block its own pull request.
- Style is not enforced and there is no formatter. Match the surrounding code.

Small, focused pull requests are much easier to review than large ones.

## License

Apache-2.0 © Macquery Labs. See [LICENSE](LICENSE).

Covers everything in `src/`, `action/` and `fixtures/`.
