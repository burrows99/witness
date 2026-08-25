import type { PlanStep, StoryArtifact, StoryEvent } from './types.js'

/**
 * The extension seams — contracts §7.
 *
 * Every axis of variation has the same shape: an interface here,
 * implementations behind it, and a free default that the full test suite must
 * pass under. The interfaces live in `core` because the gate and the runner
 * both need to name them; the implementations never do — `core` must not
 * import a driver, a probe or a recorder (NFR-7).
 */

export interface RunContext {
  runId: string
  /** Repository root; every recorded path is relative to it. */
  repoRoot: string
  /** Where this run's artefacts are written. */
  runDir: string
  /** W3C trace id threading browser → server → data for this run. */
  traceId: string
  /** Base URL of the application under test, when there is one. */
  baseUrl?: string
  env: Record<string, string | undefined>
  log(line: string): void
  /** Monotonic nanoseconds, for intra-process ordering. */
  monoNs(): number
}

/**
 * `Omit` over a union collapses it to the shared keys, which would erase the
 * event discriminants. Distributing keeps `logpoint` a logpoint.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** A story event before the harness assigns its position in the timeline. */
export type UnsequencedEvent = DistributiveOmit<StoryEvent, 'seq'>

export interface StepResult {
  status: 'ok' | 'error'
  error?: string
  /** Events the driver observed, minus `seq`, which the harness assigns. */
  events: UnsequencedEvent[]
  artifacts: StoryArtifact[]
  /** Anything an assertion may need to read later, keyed by the driver. */
  data?: Record<string, unknown>
}

/** A driver *acts*: browser, API, job. */
export interface Driver {
  readonly name: string
  readonly actions: readonly string[]
  execute(step: PlanStep, ctx: RunContext): Promise<StepResult>
  close?(): Promise<void>
}

export interface ProbeTargetRef {
  id: string
  file: string
  line: number
}

export interface InstalledProbeRef extends ProbeTargetRef {
  /** DAP `Breakpoint.verified` — SV011 hinges on this. */
  verified: boolean
  adapterLine?: number
}

/** A probe *observes inside*. */
export interface Probe {
  readonly name: string
  install(targets: readonly ProbeTargetRef[], ctx: RunContext): Promise<InstalledProbeRef[]>
  drain(): AsyncIterable<UnsequencedEvent>
  uninstall(): Promise<void>
}

export interface AssertionResult {
  status: 'pass' | 'fail' | 'skipped'
  expected?: unknown
  actual?: unknown
  /** Human-readable difference, shown verbatim in the finding. */
  diff?: string
}

/** What the harness gives an assertion to look at. */
export interface StoryView {
  /** Result of the step an assertion is anchored to. */
  stepResult(seq: number): StepResult | undefined
  events(): readonly UnsequencedEvent[]
  artifacts(): readonly StoryArtifact[]
}

export interface AssertionKind {
  readonly kind: string
  evaluate(spec: Record<string, unknown>, view: StoryView, step: number): Promise<AssertionResult> | AssertionResult
}

/**
 * What a recorder can emit. `video` and `cast` are first-class: a recording is
 * evidence like any other artefact, not a driver's private business.
 */
export const ARTIFACT_KINDS = ['frame', 'video', 'transcript', 'snapshot', 'cast', 'log'] as const
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

export function isArtifactKind(value: string): value is ArtifactKind {
  return (ARTIFACT_KINDS as readonly string[]).includes(value)
}

/** Where in the story an artefact belongs. */
export interface StepRef {
  seq: number
  driver: string
  action: string
}

/**
 * A recorder *captures evidence*, across a whole run.
 *
 * It is a session — `start`, then `mark` at each step boundary, then `stop` —
 * rather than a per-step callback. A video is one continuous artefact
 * spanning the run, and only `mark` can tie a moment inside it back to a
 * step. A per-step `capture()` cannot express that, so recording would have
 * to live inside a driver, where no other consumer can reach it.
 */
export interface Recorder {
  readonly name: string
  readonly produces: readonly ArtifactKind[]
  start(ctx: RunContext): Promise<void>
  /** Called as each step begins, so artefacts can carry a `step_seq`. */
  mark(step: StepRef): Promise<void>
  /** Everything captured, declared with its readers. */
  stop(): Promise<StoryArtifact[]>
}
