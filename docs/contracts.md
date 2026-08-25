# swe-verify — contracts addendum

Companion to the design doc. Everything here is the *what exactly*, not the *why*.
Merge as a new top-level section (suggested position: after **Design**, before **Extension seams**).

---

## 0. Worked example (put this near the top of the doc)

The single biggest readability fix. A reader should see the whole product in 40 lines before any rationale.

```console
$ swe-verify init
wrote .swe-verify/config.json

$ swe-verify plan --intent "checkout applies the tiered discount" --scope 'src/pricing/**'
wrote .swe-verify/plans/checkout-discount.plan.json  (3 steps, 2 assertions)
# edit the plan, commit it with your change

$ swe-verify run --plan .swe-verify/plans/checkout-discount.plan.json
  fixtures  up (compose, 4 services)            2.1s
  probes    12 logpoints on 12 changed lines    0.4s   [12 verified]
  driver    web: goto /cart -> click "Place order"
  story     .swe-verify/runs/01JB7Q.../story.json  (47 events, 3 tiers)

$ swe-verify gate --run 01JB7Q...
BLOCK  2 findings

  SV010  src/pricing/discount.ts:41   applyTiered()  changed line never executed
  SV010  src/pricing/discount.ts:42   applyTiered()  changed line never executed

  coverage   10/12 changed lines exercised
  assertions 2/2 passed
  diff_hash  match (sha256:9f2a…)

exit 2
```

Failure output is the product surface people actually meet. Design it in the doc, not in the code.

---

## 1. Artefact binding — a contradiction in the current draft

The doc says `plan.json` is **committed** and **binds to `diff_hash`**. Those can't both hold:

- The plan is authored *before* the final diff exists.
- Any subsequent commit changes `diff_hash` and invalidates every committed plan.
- Rebasing a stack of PRs would rewrite every plan file.

**Proposed split:**

| Artefact | Binds to | Where |
|---|---|---|
| `plan.json` | a **scope** — path globs + intent | committed |
| `story.json` | `diff_hash` + `plan_id` + `plan_sha256` | CI artifact |

Gate then checks three things instead of one:

1. `story.diff_hash == recompute(base…head)` → not stale.
2. `story.plan_sha256 == sha256(committed plan at head)` → the story ran the plan that's in the tree.
3. every changed line inside some plan's scope has a fired probe → not unexercised.

Rule 3 also gives a clean answer to "what if the diff touches files no plan covers": that's `SV012 out_of_scope_change`, which is a *different* failure from "we ran it and it didn't execute" and should say so.

---

## 2. `plan@1`

```jsonc
{
  "schema": "swe-verify/plan@1",
  "id": "checkout-discount",
  "intent": "checkout applies the tiered discount",
  "domain": "fullstack",

  "scope": {
    "include": ["src/pricing/**", "src/checkout/**"],
    "exclude": ["**/*.stories.tsx"]
  },

  "fixture": {
    "kind": "compose",
    "file": "fixtures/docker-compose.yml",
    "ready": [
      { "http": "http://api:3000/health", "status": 200, "timeoutMs": 60000 }
    ],
    "seed": ["fixtures/seed.sql"]
  },

  "steps": [
    { "seq": 1, "driver": "web", "action": "goto",  "args": { "path": "/cart" } },
    { "seq": 2, "driver": "web", "action": "click", "args": { "role": "button", "name": "Place order" } },
    { "seq": 3, "driver": "api", "action": "get",   "args": { "path": "/orders/latest" } }
  ],

  "assertions": [
    { "id": "a1", "kind": "ui-text",     "afterStep": 2, "expect": { "visible": "Order confirmed" } },
    { "id": "a2", "kind": "sql-row",     "afterStep": 2,
      "query": "select status, total from orders order by id desc limit 1",
      "expect": { "status": "confirmed", "total": 42.00 } },
    { "id": "a3", "kind": "http-status", "afterStep": 3, "expect": { "status": 200 } }
  ],

  "coverage": {
    "policy": "all-executable",
    "waivers": [
      { "file": "src/pricing/discount.ts", "lines": "88-91",
        "reason": "OOM guard, not reachable in CI", "expires": "2026-12-01" }
    ]
  }
}
```

Notes worth putting in the doc:

- **`steps[].seq` is the join key** between plan, story events, and artefacts. Never reorder; append only.
- **Waivers are dated and required to carry a reason.** An undated waiver is a permanent hole; the gate should warn at 30 days to expiry and block after.
- Fixture lifecycle belongs in the plan, not in CI YAML — otherwise `local` and CI diverge and the "`local` is the proof" rule quietly dies.

---

## 3. `story@1`

The load-bearing schema. Everything else in the system is a producer or a consumer of this.

```jsonc
{
  "schema": "swe-verify/story@1",
  "run_id": "01JB7QK3M9X2VYD8N4T6",          // ULID, client-generated, idempotency key
  "plan_id": "checkout-discount",
  "plan_sha256": "sha256:a13c…",

  "diff": {
    "hash": "sha256:9f2a…",
    "algo": "normalised-v1",
    "base_sha": "b6d1…",
    "head_sha": "e402…",
    "files": 3,
    "changed_lines": 12
  },

  "vcs": { "provider": "github", "change_id": "1234", "actor": "burrows99" },
  "env":  { "cli": "0.4.1", "os": "linux/amd64", "runner": "local", "domain": "fullstack" },

  "started_at": "2026-08-24T10:11:02.401Z",
  "sealed_at":  "2026-08-24T10:11:19.883Z",

  "events":   [ /* see 3.1 */ ],
  "coverage": { /* see 3.2 */ },
  "assertions": [
    { "id": "a1", "status": "pass", "event_seq": 31, "expected": {...}, "actual": {...} },
    { "id": "a2", "status": "fail", "event_seq": 34, "expected": {...}, "actual": {...},
      "diff": "total: expected 42.00, got 46.20" }
  ],
  "artifacts": [
    { "kind": "snapshot", "path": "artifacts/a11y/0002-after.json",
      "sha256": "…", "bytes": 8102, "readableBy": ["agent"], "step_seq": 2 },
    { "kind": "video", "path": "artifacts/video/run.webm",
      "sha256": "…", "bytes": 4210331, "readableBy": ["human"] }
  ],
  "diagnostics": [
    { "code": "SV011", "severity": "error",
      "message": "logpoint accepted but unverified", "file": "src/pricing/discount.ts", "line": 55 }
  ],

  "seal": { "algo": "sha256", "value": "sha256:c0ff…", "over": "jcs(story minus seal)" }
}
```

### 3.1 Event union

One array, one discriminant, one ordering rule.

```ts
type Tier = 'browser' | 'server' | 'data' | 'harness'

type BaseEvent = {
  seq: number            // strictly increasing, harness-assigned at capture time
  tier: Tier
  trace_id: string       // W3C, threads the tiers
  span_id?: string
  parent_span_id?: string
  step_seq?: number      // join back to plan.steps
  wall: string           // ISO-8601, DISPLAY ONLY — never a sort key
  mono_ns: number        // per-process monotonic; used for intra-process ordering
}

type StepEvent      = BaseEvent & { type: 'step';      driver: string; action: string; args: Json; status: 'ok'|'error' }
type LogpointEvent  = BaseEvent & { type: 'logpoint';  probe_id: string; file: string; line: number; vars: Record<string, Json>; hit: number }
type SpanEvent      = BaseEvent & { type: 'span';      name: string; kind: 'client'|'server'|'internal'; attrs: Json; duration_ms: number }
type ArtifactEvent  = BaseEvent & { type: 'artifact';  artifact_index: number }
type AssertEvent    = BaseEvent & { type: 'assertion'; assertion_id: string; status: 'pass'|'fail' }
type DiagEvent      = BaseEvent & { type: 'diagnostic'; code: string; message: string }
```

**Ordering rule — state it explicitly in the doc.** The doc claims "causally ordered" but never says how, and containers skew clocks by tens of milliseconds, which is more than a whole request.

> Order is derived from (1) `trace_id`/`parent_span_id` causality, then (2) per-process `mono_ns`, then (3) `seq` as a tiebreak. Wall-clock timestamps are rendered but never sorted on. Any event with no trace context is attached to the enclosing `step_seq`.

Without this rule, two implementations of the viewer will draw different stories from the same file.

### 3.2 Coverage block

```jsonc
"coverage": {
  "policy": "all-executable",
  "lines": [
    { "file": "src/pricing/discount.ts", "line": 40, "class": "executable", "probe_id": "p07", "verified": true,  "hits": 3 },
    { "file": "src/pricing/discount.ts", "line": 41, "class": "executable", "probe_id": "p08", "verified": true,  "hits": 0 },
    { "file": "src/pricing/discount.ts", "line": 55, "class": "executable", "probe_id": "p09", "verified": false, "hits": 0 },
    { "file": "src/pricing/discount.ts", "line": 88, "class": "waived",     "reason": "OOM guard", "expires": "2026-12-01" },
    { "file": "src/types.ts",            "line": 12, "class": "excluded",   "reason": "type-only declaration" }
  ],
  "summary": { "executable": 12, "fired": 10, "unverified": 1, "waived": 1, "excluded": 4 }
}
```

`verified` is the DAP `Breakpoint.verified` flag. **Line 41 and line 55 are different failures** — 41 means the code didn't run, 55 means we never actually watched it. The doc identifies this as "the silent killer" and then gives both the same verdict. Separate codes, separate remedies.

---

## 4. Line classification — the false-block risk

`≤ 2% false-block` is the hardest target in the doc, and "every changed line has a fired probe" is effectively a 100% line-coverage requirement on the diff. It will fire on `catch` blocks, defensive guards, `log.debug` lines, feature-flag off-paths, and platform branches. That's where the escape hatch gets used, and a heavily-used escape hatch is a dead gate.

Define the classes in `core` so the behaviour is testable rather than emergent:

| Class | Determined by | Gate treatment |
|---|---|---|
| `excluded` | normalisation — whitespace, comments, bare brackets, imports, type-only decls | not counted |
| `executable` | has a verified probe | must fire |
| `defensive` | line is inside a `catch` / guard clause / `if (!x) throw` | policy: `off` \| `warn` \| `require` (default `warn`) |
| `waived` | explicit dated waiver in the plan | counted, reported, not blocking; capped at N% of diff |
| `unbound` | probe accepted but `verified === false` | **always blocks** — `SV011` |

Policy knobs live in config:

```jsonc
{ "coverage": { "policy": "all-executable", "defensive": "warn", "waiverCapPct": 10 } }
```

`defensive` detection needs a per-language rule, which is a small AST or a query pattern per adapter — a real cost the doc doesn't currently budget for. Alternative if you want to avoid ASTs at P1: treat `defensive` as `warn` for everyone and revisit after the first L3 mutation numbers come back.

---

## 5. Gate contract

Pure function. No I/O, no host, no git shell-out — that's how the doc's "`core` never imports `vcs`" rule becomes enforceable.

```ts
type Verdict = 'allow' | 'block' | 'bypass'

interface GateInput {
  story: Story                 // already schema-validated
  diff: NormalisedDiff         // computed by cli, passed in
  plans: PlanRef[]             // { id, sha256, scope }
  policy: Policy               // from config
  bypass: Bypass | null        // resolved by VcsProvider
}

interface Finding {
  code: GateCode
  severity: 'error' | 'warn'
  locus?: { file: string; line?: number; step_seq?: number; assertion_id?: string }
  message: string              // what happened
  remedy: string               // what to do about it
}

interface GateResult {
  verdict: Verdict
  findings: Finding[]
  metrics: { executable: number; fired: number; unverified: number; waived: number; assertionsPassed: number; assertionsTotal: number }
}

function evaluate(input: GateInput): GateResult
```

`remedy` is not padding. A gate that says "line 41 never executed" and stops has handed the developer a research task; one that says "add a step to the plan that reaches `applyTiered` with `tier >= 2`, or waive with a reason" is actionable. Bypass rate tracks this field more than any other.

### Finding codes

| Code | Meaning | Severity |
|---|---|---|
| `SV001` | no story for this change | error |
| `SV002` | story fails schema validation | error |
| `SV003` | `diff_hash` mismatch — stale evidence | error |
| `SV004` | `plan_sha256` mismatch — story ran a different plan | error |
| `SV010` | changed line never executed | error |
| `SV011` | probe accepted but unverified (path mapping / unbound) | error |
| `SV012` | changed file not covered by any plan scope | error |
| `SV013` | waiver expired | error |
| `SV014` | changed line is defensive, unexercised | warn (policy) |
| `SV020` | assertion failed | error |
| `SV021` | plan has zero assertions | warn |
| `SV030` | step has no agent-readable artefact | error |
| `SV040` | breakpoint used in CI | error |
| `SV041` | run exceeded time budget | error |
| `SV090` | gate bypassed — reason recorded | warn |

Codes are the contract with every consumer: the viewer's gate explainer, the CI annotation, the agent's next decision, and the L3 mutation harness all key off them. Freeze them at P0 and only append.

---

## 6. CLI surface and exit codes

```
swe-verify init                                    scaffold config
swe-verify plan   --intent <s> --scope <glob>...   emit a plan skeleton
swe-verify run    --plan <path> [--runner local]   execute, emit story
swe-verify gate   --run <id> | --story <path>      evaluate, publish via vcs
swe-verify verify --plan <path>                    run + gate (the agent's one command)
swe-verify show   --run <id> [--open]              render viewer
swe-verify doctor                                  adapters, ports, path mappings
```

| Exit | Meaning | CI reads it as |
|---|---|---|
| 0 | allow | green |
| 2 | block — a finding of severity `error` | red, developer's problem |
| 3 | usage / config error | red, config problem |
| 4 | **harness failure** — fixture never came up, adapter crashed, port collision | red, *our* problem |
| 5 | bypassed — recorded, published, non-blocking | amber |

**4 must be distinct from 2.** "Your change is unverified" and "our debugger failed to attach" produce identical developer frustration if they share an exit code, and the second one is the failure mode this project will hit constantly in its first six months. It also keeps catch-rate arithmetic honest — a harness crash is not a catch.

All commands accept `--json` and emit `GateResult` verbatim on stdout. That's the agent's read path; it should never parse human output.

---

## 7. Package interfaces (to sit alongside `Recorder` and `VcsProvider`)

The doc defines two of five seams. The missing three:

```ts
interface Driver {
  readonly name: string                 // 'web' | 'api' | 'job'
  readonly actions: string[]
  execute(step: PlanStep, ctx: RunContext): Promise<StepResult>
}

interface Probe {
  readonly name: string                 // 'dap' | 'otel'
  install(targets: ProbeTarget[], ctx: RunContext): Promise<InstalledProbe[]>
  drain(): AsyncIterable<Event>         // non-blocking; harness assigns seq on receipt
  uninstall(): Promise<void>
}

type InstalledProbe = {
  id: string
  file: string
  line: number
  verified: boolean                     // DAP Breakpoint.verified — SV011 hinges on this
  adapterLine?: number                  // where the adapter actually bound it, if moved
}

interface AssertionKind {
  readonly kind: string                 // 'ui-text' | 'http-status' | 'sql-row' | 'terminal-match'
  evaluate(spec: Json, story: StoryView): AssertionResult
}
```

`adapterLine` matters: adapters routinely slide a breakpoint to the next executable statement. If you record the requested line and the adapter bound line 42, coverage on line 41 looks unfired forever. Record both and treat a slide as covering the span between them.

---

## 8. On-disk layout

```
.swe-verify/
  config.json                          committed
  plans/
    checkout-discount.plan.json        committed
  runs/                                gitignored
    01JB7QK3M9X2VYD8N4T6/
      story.json
      artifacts/
        frames/0002-before.png
        a11y/0002-after.json
        api/0003.http.json
        db/0002.rows.jsonl
        trace.zip                      playwright, public API only
        video/run.webm
      logs/harness.log
      viewer.html                      self-contained, produced by `show`
```

Artefact paths inside `story.json` are relative to the run directory. Absolute paths break the CI-artifact-download-and-open workflow, which is the only way a human ever sees this.

---

## 9. Database design — needed where, exactly

**Free tier: no database.** Filesystem + CI artifact storage is the whole persistence layer, and that's the point — a gate that needs a database can't run on a laptop with no network. Say this explicitly in the doc; "do we need a DB" is the first question every reviewer will ask.

**Paid tier (`vault` + `analytics`): yes, and it's an index, not a store.**

Stories are 10² KB–10¹ MB and write-once. Don't shred events into rows at CI volume. Object storage holds the story and artefacts; Postgres holds what you query.

```sql
create table runs (
  id             char(26) primary key,          -- ULID, client-generated
  org_id         uuid not null,
  repo_id        uuid not null,
  change_id      text,                          -- PR/MR number
  base_sha       char(40) not null,
  head_sha       char(40) not null,
  diff_hash      char(71) not null,             -- 'sha256:' + 64
  verdict        text not null check (verdict in ('allow','block','bypass')),
  plan_id        text not null,
  cli_version    text not null,
  started_at     timestamptz not null,
  sealed_at      timestamptz,
  story_uri      text not null,                 -- s3://…/story.json
  story_sha256   char(71) not null,             -- matches story.seal
  retention_class text not null default 'standard'
) partition by range (started_at);

create table findings (
  run_id   char(26) references runs(id) on delete cascade,
  ord      int,
  code     text not null,
  severity text not null,
  file     text, line int,
  message  text not null,
  primary key (run_id, ord)
);

create table coverage_lines (               -- the analytics table
  run_id  char(26) not null,
  file    text not null,
  line    int  not null,
  class   text not null,
  fired   boolean not null,
  hits    int not null default 0,
  primary key (run_id, file, line)
) partition by hash (run_id);

create table artifacts (
  id           uuid primary key,
  run_id       char(26) references runs(id) on delete cascade,
  kind         text not null,
  uri          text not null,
  bytes        bigint not null,
  sha256       char(71) not null,
  readable_by  text[] not null,
  expires_at   timestamptz                   -- driven by readable_by, see below
);

create index on runs (repo_id, started_at desc);
create index on runs (repo_id, diff_hash);
create index on findings (run_id, code);
create index on coverage_lines (file, line) where fired = false;
```

Three things this schema buys that the doc's cloud economics section asks for but doesn't cost:

- **Flake detection** is `select file, line from coverage_lines group by … having count(distinct fired) > 1` over a repo's recent runs. That's the analytics product, and it only works if coverage is indexed per line, not buried in a blob.
- **Differential retention** falls out of `artifacts.readable_by`: `['human']` artefacts (video, trace) get 14 days, `['agent']` artefacts (snapshots, transcripts) get 12 months. That's the storage margin lever, made concrete.
- **Idempotent upload**: client-generated ULID as PK means a retried CI job is a no-op, not a duplicate.

**Redaction placement:** the doc rightly says redaction runs before disk, not before upload. That means it lives in `packages/core` (or a `packages/redact`), applied at event-capture time in the free tier — the cloud inherits it and adds policy on top. If redaction is only in `cloud/`, the free CLI writes secrets to CI artifacts, which is a worse leak than the vault ever was.

---

## 10. Cloud API

Small on purpose. The CLI must work identically with it absent.

```
POST   /v1/runs                     { run_id, repo, base_sha, head_sha, diff_hash }
                                    → { upload: { story: <presigned>, artifacts: <presigned prefix> } }
POST   /v1/runs/{run_id}/seal       server validates schema + recomputes seal → { verdict, findings }
GET    /v1/runs/{run_id}            → run metadata + findings
GET    /v1/runs/{run_id}/story      → 302 to signed URL
GET    /v1/repos/{repo_id}/runs     ?change_id= &verdict= &since=
GET    /v1/repos/{repo_id}/flake    ?file= &line= &window=30d
```

- **Auth: OIDC workload identity from the CI provider** (GitHub Actions `id-token`, GitLab `CI_JOB_JWT`), exchanged for a short-lived token. No long-lived secrets in CI. For `local`, a PAT.
- **Idempotency** on `run_id`; re-POST returns the existing record.
- **Server re-validates the seal.** A client-computed verdict is a claim; the vault's value is that it independently recomputed it.
- Everything is `202`-friendly — artefact upload is out of band via presigned URLs, so the control plane never proxies a 4 MB video.

---

## 11. Versioning and compatibility

| Rule | |
|---|---|
| `schema` field is mandatory on `plan` and `story` | `swe-verify/story@1` |
| Within a major: additive only | new optional fields, new event types, new finding codes |
| Unknown **major** → `SV002`, refuse | never best-effort parse |
| Unknown **minor** field → ignore, warn once | forward compatibility for old CLIs reading new stories |
| Finding codes are append-only | consumers key off them |
| `diff_hash` algo is versioned in the story (`normalised-v1`) | changing normalisation is a new algo, not a silent rehash |

That last one is easy to miss and expensive: if you improve normalisation without versioning it, every open PR's story goes stale on the day you ship.

---

## 12. Config

```jsonc
// .swe-verify/config.json
{
  "schema": "swe-verify/config@1",
  "domain": "fullstack",
  "vcs": "auto",                         // auto | github | gitlab | bitbucket | local
  "runner": "local",
  "artifactStore": "fs",
  "telemetry": "off",

  "scope": {
    "include": ["src/**", "server/**"],
    "exclude": ["**/*.md", "**/*.test.ts", "**/migrations/**"],
    "languages": ["ts", "py", "go"]
  },

  "coverage": { "policy": "all-executable", "defensive": "warn", "waiverCapPct": 10 },

  "budgets": { "runMs": 600000, "breakpointMs": 30000, "artifactBytes": 524288000 },

  "bypass": { "allowed": true, "requiresReason": true, "label": "swe-verify:bypass" },

  "redact": {
    "keys": ["password", "token", "secret", "authorization", "cookie", "ssn"],
    "patterns": ["(?i)bearer\\s+[a-z0-9._-]+"],
    "onUnknownBinary": "drop"
  }
}
```

---

## Summary of changes this implies to the main doc

| # | Change | Why |
|---|---|---|
| 1 | Add the worked example near the top | the doc currently has no picture of the product in use |
| 2 | Un-bind `plan.json` from `diff_hash`; bind it to scope | committed plans can't hold a hash that changes every commit |
| 3 | Add the ordering rule to **The story** | "causally ordered" is currently unspecified and clock-skew-fragile |
| 4 | Add line classification + `defensive` policy | the ≤2% false-block target is otherwise unreachable |
| 5 | Split `SV010` (never ran) from `SV011` (never watched) | the doc names this failure and then merges the verdicts |
| 6 | Add exit code 4 for harness failure | otherwise our bugs read as the developer's bugs |
| 7 | State "free tier has no database" | pre-empts the first reviewer question |
| 8 | Move redaction into `core`, not `cloud` | the doc's own rule (redact before disk) requires it |
| 9 | Add `Driver`, `Probe`, `AssertionKind` interfaces | three of five seams are currently undefined |
| 10 | Version the `diff_hash` normalisation algo | improving normalisation would otherwise stale every open PR |