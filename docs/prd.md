# swe-verify — Product Requirements Document

| | |
|---|---|
| **Document type** | PRD — *what* and *why*. The *how* lives in the [TDD](./swe-verify-TDD.md). |
| **Status** | Draft |
| **Owner** | @burrows99 |
| **Reviewers** | *(unassigned)* |
| **Created** | 2026-08-24 |
| **Last updated** | 2026-08-24 |
| **Version** | 0.1 |
| **Related** | [Technical Design Doc](./swe-verify-TDD.md) · [Contracts appendix](./swe-verify-contracts.md) |

---

## 1. Summary

Coding agents change code and declare it done without ever running it. The industry's response has been advisory — prompts, skills, `AGENTS.md` — all of which an agent can ignore. The enforcing alternatives are vendor hooks, which stop working the moment you switch from Claude Code to Cursor to Codex.

`swe-verify` moves enforcement to the only layer that is both universal and binding: CI. A run produces one artefact — a **story**, a causally ordered timeline of what was driven and what happened across browser, server and database. CI re-checks that story against the diff it claims to verify and blocks the merge if the changed code was never exercised, the evidence is stale, or the assertions failed.

Because the gate reads a diff and a JSON file, it works with any vendor's agent, with several at once, or with none. v1 targets solo developers and small teams shipping full-stack web applications with agent assistance. The engine is Apache-2.0; hosted runners and a persistent evidence vault are the commercial layer.

---

## 2. Background and context

Three facts define the problem space as of mid-2026:

1. **Agent-authored diffs are now a majority of PR volume** in teams that have adopted agents, and review capacity has not scaled with them. The reviewer's question has shifted from "is this code good" to "did anyone run this".
2. **Advisory instruction does not bind.** `AGENTS.md` and MCP `instructions` are steering, not enforcement. Stateful MCP tool gating enforces only if the agent chooses to enter the tool.
3. **Evidence is siloed.** Browser frames, server logs and database state live in three places with three clocks. Today an agent hand-stitches them by timestamp, badly, and a human re-does the work during review.

Existing tooling does not close this. Test suites prove a *system* is correct, not that *this change* was executed. Coverage tools report line coverage over a whole suite, not over a diff, and don't tie a line to the user-facing flow that reached it. Debug-MCP tools exist but ship as IDE extensions and cannot run in CI.

**Why now:** DAP logpoints (non-suspending, in-spec) and W3C trace context make cross-tier capture tractable without stopping the process, and RealWorld gives a free cross-language conformance fixture that previously would have cost months to build.

---

## 3. Users and jobs to be done

| ID | Persona | Job to be done | Success looks like |
|---|---|---|---|
| **U1** | **The coding agent** *(non-human, primary user)* | Prove the change I made actually ran, without me hand-collecting evidence | One command, one JSON file to read, machine-readable verdict |
| **U2** | **Solo dev / OSS maintainer** | Stop merging agent PRs that were never executed | Red check with a specific unexercised line, on a laptop, no account |
| **U3** | **Reviewer** | Know in 30 seconds whether to trust this PR | Plan visible in the diff; story linked from the check; viewer, not JSON |
| **U4** | **Platform / EM** | Adopt a policy that survives changing agent vendors | One config, no per-vendor code, bypass rate visible |
| **U5** | **Security reviewer** *(gates paid tier)* | Answer "where does captured variable state go" | Redaction before disk, per-field policy, retention limits |

**U1 is the unusual one and it drives most of the design.** The primary user cannot watch a video, cannot read a screenshot reliably, and cannot be trusted to follow instructions. Every requirement below that mentions "machine-readable", "one artefact", or "declared readers" exists because of U1.

---

## 4. User stories

Format: *As a [persona], I want [capability] so that [outcome].* Acceptance criteria are the contract with QA and with the L3 mutation harness.

**US-1 — Block unverified change** *(U2, U3)*
> As a maintainer, I want a PR whose changed code was never executed to fail CI, so that "looks fine" stops being the merge criterion.

- **AC1** A PR with no story present fails with exit 2 and finding `SV001`.
- **AC2** A PR with a story whose `diff_hash` does not match the PR diff fails with `SV003`.
- **AC3** A PR where a changed executable line has no fired probe fails with `SV010`, naming file and line.
- **AC4** A comment-only or formatting-only PR passes.

**US-2 — Prove it without collecting it** *(U1)*
> As an agent, I want to declare an intent and receive one artefact, so that I never correlate logs by timestamp.

- **AC1** A single command produces one `story.json` covering every tier the run touched.
- **AC2** Browser action, server variable state and DB query for one request share one `trace_id`.
- **AC3** All output is available as JSON on stdout; no human-formatted output needs parsing.

**US-3 — Run it anywhere, with no account** *(U2)*
> As a solo dev, I want the gate to run on my laptop with no host, token or network.

- **AC1** `--vcs local` passes the full gate test suite.
- **AC2** No network call is made in a `local` + `fs` + `off` configuration.
- **AC3** Installation is a single binary; no `npm install` in CI.

**US-4 — Review intent, not just outcome** *(U3)*
> As a reviewer, I want to see what the agent intended to prove, separately from whether it passed.

- **AC1** `plan.json` is committed alongside the change and readable in the PR diff.
- **AC2** The story records which plan it executed; a mismatch fails with `SV004`.
- **AC3** A run is auditable from the viewer in under 30 seconds without reading JSON.

**US-5 — Survive a vendor switch** *(U4)*
> As a platform lead, I want to change agent vendors without losing the gate.

- **AC1** The gate functions with zero vendor-specific code installed.
- **AC2** Two different agent runtimes drive the same CLI and produce interchangeable stories.

**US-6 — Escape, visibly** *(U2, U4)*
> As a developer blocked by a wrong verdict, I want an escape hatch that is recorded rather than silent.

- **AC1** Bypass requires a reason string.
- **AC2** Bypass is published to the PR and emitted as `SV090`, exit 5 — amber, not green.
- **AC3** Bypass rate is queryable over time.

**US-7 — Trust the failure message** *(U2)*
> As a developer, I want to distinguish "my change is unverified" from "the harness broke".

- **AC1** Harness failure exits 4, never 2.
- **AC2** Every finding carries a `remedy` field stating the next action.
- **AC3** `swe-verify doctor` diagnoses adapter, port and path-mapping problems without running a full verification.

---

## 5. Goals and non-goals

**Goals**

- G1 — A change that was never exercised cannot merge.
- G2 — Works with any coding agent, and with none.
- G3 — One artefact serves three readers: agent, gate, human.
- G4 — Extends to new evidence layers and new engineering domains without changing `core`.
- G5 — Runs on a laptop with no host, no token and no network.

**Non-goals** *(things that could reasonably be goals, deliberately excluded)*

- **Replacing test suites.** This proves a change was *exercised*, not that a system is *correct*.
- **Judging whether behaviour is right.** Only whether it was observed. A human or an assertion decides correctness.
- **Monitoring or APM.** Everything is scoped to one change, in CI.
- **Every language.** A language without a trustworthy DAP adapter is unsupported on purpose.
- **Autonomous repair.** The harness reports; it does not fix.
- **Replacing code review.** The gate answers one question; a reviewer still answers the rest.

---

## 6. Success metrics

Two primary metrics, recomputed every release and published in the README. They are only meaningful as a pair: catch rate alone is maximised by blocking everything; false-block rate alone is maximised by a gate that never fires.

| ID | Metric | Definition | Target | Instrumented by |
|---|---|---|---|---|
| **M1** | Catch rate | injected mutations the gate blocks | ≥ 95% | L3 mutation suite |
| **M2** | False-block rate | harmless diffs the gate wrongly blocks | ≤ 2% | L3 null-mutation suite |

Secondary, tracked but not targeted:

| ID | Signal | Why it matters | Watch threshold |
|---|---|---|---|
| **M3** | Bypass rate | a climbing number means the gate is wrong more often than useful | > 10% of gated PRs |
| **M4** | Time to red | a correct gate that takes 20 minutes gets routed around | p95 > 10 min |
| **M5** | Harness failure rate (exit 4) | our bugs masquerading as the developer's | > 2% of runs |

**M5 is the leading indicator.** In the first two quarters the project is far more likely to die of flaky debugger attachment than of poor catch rate.

---

## 7. Requirements

Priority: **P0** must ship in v1 · **P1** v1 if possible · **P2** post-v1.

### 7.1 Functional

| ID | Requirement | Pri | Stories | Acceptance |
|---|---|---|---|---|
| FR-1 | Block a change with no story | P0 | US-1 | `SV001`, exit 2 |
| FR-2 | Block a change whose story is stale relative to the diff | P0 | US-1 | `SV003`, exit 2 |
| FR-3 | Block a change whose assertions failed | P0 | US-1 | `SV020`, exit 2 |
| FR-4 | Commit a reviewable verification plan | P0 | US-4 | `plan.json` in the diff; `SV004` on mismatch |
| FR-5 | Operate with no host, token or network | P0 | US-3 | `local` provider passes full suite |
| FR-6 | Record and publish an explicit bypass | P0 | US-6 | reason required; `SV090`, exit 5 |
| FR-7 | Emit machine-readable results | P0 | US-2 | `--json` on every command |
| FR-8 | Distinguish harness failure from verdict | P0 | US-7 | exit 4 ≠ exit 2 |
| FR-9 | Auto-instrument changed lines as trace probes | P1 | US-1, US-2 | no per-line agent decision or config |
| FR-10 | Block on unexercised changed lines | P1 | US-1 | `SV010` with file:line |
| FR-11 | Distinguish unexercised from unobserved | P1 | US-7 | `SV011` when `Breakpoint.verified === false` |
| FR-12 | Dated, reasoned coverage waivers | P1 | US-6 | expiry enforced via `SV013`; capped as % of diff |
| FR-13 | Assemble one cross-tier story on a single correlation id | P1 | US-2 | browser → server → DB share `trace_id` |
| FR-14 | Diagnose environment problems standalone | P1 | US-7 | `swe-verify doctor` |
| FR-15 | Require ≥1 agent-readable artefact per step | P2 | US-2 | `SV030` |
| FR-16 | Human-auditable story viewer | P2 | US-4 | single self-contained HTML, offline |
| FR-17 | MCP adapter and `AGENTS.md` generation | P2 | US-5 | ≥2 vendors, zero vendor code in core |
| FR-18 | Interactive breakpoints, time-bounded, local only | P2 | — | `SV040` if used in CI |

### 7.2 Non-functional

| ID | Requirement | Pri | Measured by |
|---|---|---|---|
| NFR-1 | Catch rate ≥ 95% | P0 | M1 |
| NFR-2 | False-block rate ≤ 2% | P0 | M2 |
| NFR-3 | Time to red: p50 ≤ 5 min, p95 ≤ 10 min on the reference fleet | P1 | M4 |
| NFR-4 | Zero network egress in the free default configuration | P0 | egress assertion in CI |
| NFR-5 | Redaction applied **before** any artefact is written to disk | P0 | secret-injection test in L1 |
| NFR-6 | Distributed as a single binary; no package install step in CI | P0 | fleet CI uses the binary only |
| NFR-7 | `core` has no dependency on drivers, probes or `vcs`; gate runs with no browser and no debugger installed | P0 | build-time import check |
| NFR-8 | Deterministic capture — no probe sampling | P0 | repeat-run equality test |
| NFR-9 | Schema forward-compatibility: unknown minor fields ignored, unknown major rejected | P1 | schema contract tests |
| NFR-10 | No Apache-2.0 package may import an FSL package | P0 | build-time import check |
| NFR-11 | A suspended process can never hang a run | P0 | budget enforcement test |
| NFR-12 | Supported languages declared explicitly; unsupported languages refuse rather than degrade | P0 | `doctor` output |

---

## 8. Scope

**In scope for v1**

- Full-stack web applications: browser, HTTP/gRPC API, SQL database.
- Languages with trustworthy DAP adapters: TypeScript/JavaScript, Python, Go, Java.
- Hosts: GitHub, GitLab, Bitbucket, and `local`.
- Free tier only — `local` runner, `fs`/`ci` artifact store, telemetry off.

**Out of scope for v1** *(with the reason, so it doesn't get relitigated)*

| Excluded | Reason |
|---|---|
| Mobile and desktop app targets | no equivalent of the browser driver; large separate driver surface |
| Languages without a DAP adapter | a gate that degrades to log-scraping is flaky, and flaky gates get bypassed |
| NoSQL / event-store recorders | SQL covers the v1 fleet; recorder seam makes this additive later |
| Data-engineering / ML domain packs | structure supports them; no v1 fixture or user |
| Hosted runners and evidence vault | commercial tier, gated on the security review in §12 |
| Autonomous fix suggestions | non-goal; changes the product from a gate to an agent |

---

## 9. Release criteria

Each milestone ships something usable on its own. Nothing ships until all six checks in §9.1 hold.

| Milestone | Ships | Release criterion |
|---|---|---|
| **M0 — Spine** | story schema, `check`, vcs interface, CI action | A change with no story is blocked, on ≥1 host **and** under `local`. Hand-written stories pass. |
| **M1 — Backend probes** | DAP logpoints, diff auto-instrumentation | A backend-only change is gated on line coverage with no browser involved. Catch rate published. |
| **M2 — UI probes** | Playwright driver, correlation id | A UI action links to the server frame it caused, on one `trace_id`. |
| **M3 — Viewer** | swimlanes, coverage map, gate explainer | A human audits a run in 30s without reading JSON. |
| **M4 — Adapters** | MCP, `AGENTS.md`, vendor hooks | Works from ≥2 agent vendors with zero per-vendor code in `core`. |
| **M5 — Scale** | breakpoints, flake triage, multi-repo | Time-bounded interactive debugging; flake detection across runs. |

### 9.1 Definition of done, every increment

1. L0 unit green.
2. L1 adapter contract green for **every** language the increment claims.
3. ≥1 L2 fleet app exercised end to end.
4. ≥1 L3 mutation caught **and** the null mutation not blocked.
5. L4 — the PR gates itself with its own story.
6. M1 and M2 posted in the PR.

Rule 5 is the honest one. If `swe-verify` cannot gate its own pull request, there is no argument for asking anyone else to adopt it.

---

## 10. Rollout

| Phase | Audience | Gate mode | Exit signal |
|---|---|---|---|
| **Alpha** | this repo only (dogfood) | blocking | M1 ≥ 90%, M2 ≤ 5% |
| **Private beta** | 5–10 OSS repos with agent-heavy PR flow | **warn only** | M2 ≤ 2% sustained over 500 PRs |
| **Public v1** | anyone | opt-in blocking, warn default | M3 < 10% |
| **Commercial** | teams | unchanged | security review passed |

**Warn-only in beta is a requirement, not caution.** A gate that blocks wrongly in its first week is uninstalled in its second, and the false-block number needed to justify blocking mode can only be measured in the field.

---

## 11. Packaging and pricing

| Component | Audience | Licence | Price |
|---|---|---|---|
| CLI, core, probes, recorders, vcs, domains | agents, solo devs | Apache-2.0 | free |
| Local story viewer | solo devs | Apache-2.0 | free |
| Cloud runners | teams, CI | FSL-1.1-ALv2 | paid |
| Story vault, analytics, governance | managers, QA, security | FSL-1.1-ALv2 | paid |

- **Pricing unit: verification-minutes plus retained storage.** Seats do not track cost — running untrusted code in ephemeral containers while streaming traces and video does. A per-seat price loses money on exactly the customers who adopt hardest.
- **FSL, not MIT, for the control plane** — source-available, self-hostable internally, prohibits a competing managed service, converts to Apache-2.0 two years after each version ships. It is not OSI-approved, so the free tier must never depend on an FSL package (NFR-10).

---

## 12. Risks

| ID | Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | **False-block rate exceeds 2%**, gate gets disabled | H | H | line classification with `defensive` policy; warn-only beta; dated waivers | eng |
| R2 | **DAP path mapping fails silently** — probe accepted, never fires, looks identical to "never ran" | H | H | assert `Breakpoint.verified === true` in every contract test; distinct `SV011`; `doctor` | eng |
| R3 | **Harness flakiness read as product failure** | H | M | exit 4 distinct from exit 2; M5 tracked from day one; randomised ports via Testcontainers | eng |
| R4 | **Fork of `mcp-debugger` rots** | M | M | fork at a tagged release; strip in one commit; scheduled rebase; abandon if delta > 30% | eng |
| R5 | **Captured variable state leaks credentials into CI artifacts** | M | H | redaction in `core`, before disk (NFR-5); secret-injection test | eng + security |
| R6 | **Adoption friction** — plan authoring feels like writing tests twice | M | H | `plan` scaffolds from intent; agent authors it, not the human | product |
| R7 | **Ecosystem drift** breaks adapters silently | M | M | L5 nightly soak against upstream HEAD | eng |
| R8 | **Licence split retrofit becomes impossible** once contributors sign on | L | H | package boundary decided before first external contribution | owner |
| R9 | **Storage cost dominates unit economics** on the paid tier | M | M | `readableBy`-driven differential retention; diff-scoped skipping | product |

---

## 13. Open questions

| # | Question | Blocks | Needed by |
|---|---|---|---|
| Q1 | Does `defensive` line detection need a per-language AST, or is `warn` sufficient for v1? | R1, FR-10 | M1 |
| Q2 | Who authors `plan.json` in practice — agent, human, or scaffolded then edited? | R6 | M0 |
| Q3 | Is line-level the right coverage granularity for Java, where a statement spans lines? | FR-10 | M1 |
| Q4 | What is the waiver cap that keeps the gate meaningful without being punitive? | FR-12 | M1 |
| Q5 | Do beta users want warn-only per-repo or per-path? | rollout | beta |

---

## 14. Dependencies and assumptions

**Depends on**

- DAP adapters per language: debugpy, js-debug, Delve, java-debug — external release cadence.
- Playwright's public tracing API (not its internal trace format).
- RealWorld reference implementations remaining spec-conformant.
- CI providers exposing OIDC identity for the paid tier.

**Assumes**

- The application under verification can be brought up in containers from the repo. Projects with no runnable local environment are out of reach, and that is a real adoption ceiling worth measuring in beta.
- Agents will shell out to a CLI. Every current vendor does.
- Diffs are small enough that per-line instrumentation overhead is acceptable. Large mechanical refactors are the counter-case and may need a path filter.

---

## Appendix A — Glossary

| Term | Meaning |
|---|---|
| **Story** | The run artefact: a causally ordered, cross-tier timeline bound to a `diff_hash`. |
| **Plan** | The committed statement of what a change intends to prove: steps plus assertions. |
| **Probe** | A non-suspending observation point. DAP logpoint (server) or OTel span (cross-tier). |
| **Driver** | The thing that *acts*: browser, API, job. |
| **Recorder** | The thing that *captures*: frames, transcripts, SQL rows, terminal output. |
| **Gate** | The pure function that turns a story plus a diff into allow/block/bypass. |
| **`diff_hash`** | SHA-256 over the normalised diff; binds evidence to the change it claims to verify. |
| **Mutation** | A deliberately injected bug used to measure catch rate. |
| **Null mutation** | A harmless diff used to measure false-block rate. |