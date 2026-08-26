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
  /**
   * The text of an artefact this run wrote, by its story-relative path, or
   * `null` when there is none. An assertion that reads what a recorder
   * produced is asserting on the same evidence the reviewer watches.
   */
  readText(path: string): string | null
}

export interface AssertionKind {
  readonly kind: string
  evaluate(spec: Record<string, unknown>, view: StoryView, step: number): Promise<AssertionResult> | AssertionResult
}

/**
 * What a recorder can emit. `video` and `cast` are first-class: a recording is
 * evidence like any other artefact, not a driver's private business. So is
 * `har` — a video of a network failure shows a spinner, and the HAR shows the
 * cause, which is the difference between evidence a human can watch and
 * evidence an agent can diagnose from.
 */
export const ARTIFACT_KINDS = ['frame', 'video', 'transcript', 'snapshot', 'cast', 'log', 'har'] as const
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

/** The part of a recorder a contract check needs — so a stub can be checked too. */
export interface RecorderDeclaration {
  readonly name: string
  readonly produces: readonly string[]
}

export interface RecordingCheckOptions {
  /**
   * SV030: at least one artefact an agent can read. The agent is the primary
   * user of this system and cannot watch a video, so a run whose only output
   * is an mp4 has produced nothing it can check.
   */
  requireAgentReadable?: boolean
}

/**
 * Hold a recorder to what it declared.
 *
 * `produces` is a promise about output, and a promise nothing checks is a
 * comment. Keeping the check here — pure, in `core`, naming no recording
 * technology — is what lets the runner, the conformance suite and a
 * third-party recorder's own tests apply exactly the same one. A recorder
 * that swaps Playwright for ffmpeg-screen or VHS for asciinema changes
 * nothing about what a consumer may expect.
 *
 * Returns human-readable violations, empty when the output is conformant.
 */
export function validateRecording(
  recorder: RecorderDeclaration,
  artifacts: readonly StoryArtifact[],
  options: RecordingCheckOptions = {},
): string[] {
  const violations: string[] = []
  const declared = new Set(recorder.produces)

  for (const kind of recorder.produces) {
    if (!isArtifactKind(kind)) {
      violations.push(`recorder "${recorder.name}" declares produces: "${kind}", which is not an artefact kind`)
    }
  }

  for (const artifact of artifacts) {
    if (!isArtifactKind(artifact.kind)) {
      violations.push(`recorder "${recorder.name}" emitted "${artifact.kind}" (${artifact.path}), which is not an artefact kind`)
    } else if (!declared.has(artifact.kind)) {
      violations.push(
        `recorder "${recorder.name}" emitted "${artifact.kind}" (${artifact.path}) but produces only ${[...declared].join(', ')}`,
      )
    }
    if (artifact.readableBy.length === 0) {
      violations.push(`recorder "${recorder.name}" emitted ${artifact.path} with no declared reader`)
    }
  }

  if (options.requireAgentReadable && artifacts.length > 0) {
    if (!artifacts.some((a) => a.readableBy.includes('agent'))) {
      violations.push(
        `recorder "${recorder.name}" produced nothing an agent can read — a video alone is not evidence the agent can check`,
      )
    }
  }

  return violations
}
