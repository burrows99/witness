import type { LineClass } from './classify.js'

export type Tier = 'browser' | 'server' | 'data' | 'harness'
export type Verdict = 'allow' | 'block' | 'bypass'
export type Severity = 'error' | 'warn'

/* ------------------------------------------------------------------ plan@1 */

export interface PlanScope {
  include: string[]
  exclude?: string[]
}

export interface PlanReadyCheck {
  http?: string
  status?: number
  timeoutMs?: number
  cmd?: string
}

export interface PlanFixture {
  kind: 'compose' | 'none' | 'process'
  file?: string
  /** Language of the program, so the right debug adapter is chosen. */
  language?: string
  /** Entry point the adapter starts under the debugger. */
  program?: string
  /** Where the API driver points, when the fixture serves HTTP. */
  baseUrl?: string
  /** Wait for the process to exit before sealing: right for a job, wrong for a server. */
  awaitExit?: boolean
  /** An already-listening debug port, for a fixture brought up elsewhere. */
  attach?: { host?: string; port?: number }
  ready?: PlanReadyCheck[]
  seed?: string[]
  env?: Record<string, string>
}

export interface PlanStep {
  seq: number
  driver: string
  action: string
  args: Record<string, unknown>
}

export interface PlanAssertion {
  id: string
  kind: string
  afterStep: number
  query?: string
  expect: Record<string, unknown>
}

export interface Waiver {
  file: string
  /** A single line ("41") or an inclusive range ("88-91"). */
  lines: string
  reason: string
  /** ISO date. An undated waiver is a permanent hole, so it is required. */
  expires: string
}

export interface PlanCoverage {
  policy?: 'all-executable'
  waivers?: Waiver[]
}

export interface Plan {
  schema: 'swe-verify/plan@1'
  id: string
  intent: string
  domain?: string
  scope: PlanScope
  fixture?: PlanFixture
  steps: PlanStep[]
  assertions: PlanAssertion[]
  coverage?: PlanCoverage
}

/** What the gate needs to know about a committed plan. */
export interface PlanRef {
  id: string
  sha256: string
  scope: PlanScope
  waivers: Waiver[]
  assertionCount: number
}

/* ----------------------------------------------------------------- story@1 */

export interface BaseEvent {
  seq: number
  tier: Tier
  trace_id: string
  span_id?: string
  parent_span_id?: string
  step_seq?: number
  /** ISO-8601. Display only — never a sort key (TDD §7.1). */
  wall: string
  /** Per-process monotonic nanoseconds; orders events inside one process. */
  mono_ns: number
}

export type StepEvent = BaseEvent & {
  type: 'step'
  driver: string
  action: string
  args: Record<string, unknown>
  status: 'ok' | 'error'
  error?: string
}
export type LogpointEvent = BaseEvent & {
  type: 'logpoint'
  probe_id: string
  file: string
  line: number
  vars: Record<string, unknown>
  hit: number
}
export type SpanEvent = BaseEvent & {
  type: 'span'
  name: string
  kind: 'client' | 'server' | 'internal'
  attrs: Record<string, unknown>
  duration_ms: number
}
export type ArtifactEvent = BaseEvent & { type: 'artifact'; artifact_index: number }
export type AssertEvent = BaseEvent & { type: 'assertion'; assertion_id: string; status: 'pass' | 'fail' }
export type DiagEvent = BaseEvent & { type: 'diagnostic'; code: string; message: string }

export type StoryEvent =
  | StepEvent
  | LogpointEvent
  | SpanEvent
  | ArtifactEvent
  | AssertEvent
  | DiagEvent

export interface CoverageLine {
  file: string
  line: number
  class: LineClass
  probe_id?: string
  /** DAP `Breakpoint.verified` — SV011 hinges on this. */
  verified?: boolean
  /** Where the adapter actually bound the probe, if it slid the line. */
  adapter_line?: number
  hits?: number
  reason?: string
  expires?: string
}

export interface CoverageSummary {
  executable: number
  fired: number
  unverified: number
  waived: number
  excluded: number
  defensive: number
}

export interface StoryCoverage {
  policy: string
  lines: CoverageLine[]
  summary: CoverageSummary
}

export interface StoryAssertion {
  id: string
  status: 'pass' | 'fail' | 'skipped'
  event_seq?: number
  expected?: unknown
  actual?: unknown
  diff?: string
}

export type Reader = 'agent' | 'human'

export interface StoryArtifact {
  kind: string
  path: string
  sha256: string
  bytes: number
  readableBy: Reader[]
  step_seq?: number
}

export interface StoryDiagnostic {
  code: string
  severity: Severity
  message: string
  file?: string
  line?: number
}

export interface Seal {
  algo: 'sha256'
  value: string
  over: 'jcs(story minus seal)'
}

export interface Story {
  schema: 'swe-verify/story@1'
  run_id: string
  plan_id: string
  plan_sha256: string
  diff: {
    hash: string
    algo: string
    base_sha: string
    head_sha: string
    files: number
    changed_lines: number
  }
  vcs: { provider: string; change_id?: string; actor?: string }
  env: { cli: string; os: string; runner: string; domain: string; breakpoints?: number }
  started_at: string
  sealed_at?: string
  events: StoryEvent[]
  coverage: StoryCoverage
  assertions: StoryAssertion[]
  artifacts: StoryArtifact[]
  diagnostics: StoryDiagnostic[]
  seal?: Seal
}

/* ---------------------------------------------------------------- config@1 */

export type DefensivePolicy = 'off' | 'warn' | 'require'

export interface ResolvedConfig {
  schema: 'swe-verify/config@1'
  domain: string
  vcs: 'auto' | 'github' | 'gitlab' | 'bitbucket' | 'local'
  runner: 'local'
  artifactStore: 'fs' | 'ci'
  telemetry: 'off' | 'on'
  scope: { include: string[]; exclude: string[]; languages: string[] }
  coverage: { policy: 'all-executable'; defensive: DefensivePolicy; waiverCapPct: number }
  budgets: { runMs: number; breakpointMs: number; artifactBytes: number; probeLines: number }
  bypass: { allowed: boolean; requiresReason: boolean; label: string }
  artifacts: { requireAgentReadable: boolean }
  redact: { keys: string[]; patterns: string[]; onUnknownBinary: 'drop' | 'keep' }
}

export type Config = Partial<Omit<ResolvedConfig, 'schema'>> & { schema: 'swe-verify/config@1' }

/* ------------------------------------------------------------------- gate */

export type GateCode =
  | 'SV001' | 'SV002' | 'SV003' | 'SV004'
  | 'SV010' | 'SV011' | 'SV012' | 'SV013' | 'SV014' | 'SV015' | 'SV016'
  | 'SV020' | 'SV021'
  | 'SV030'
  | 'SV040' | 'SV041'
  | 'SV090'

export interface Locus {
  file?: string
  line?: number
  step_seq?: number
  assertion_id?: string
}

export interface Finding {
  code: GateCode
  severity: Severity
  locus?: Locus
  /** What happened. */
  message: string
  /** What to do about it — the field bypass rate tracks most (TDD §7.6). */
  remedy: string
}

export interface Bypass {
  reason: string
  actor?: string
  source?: string
}
