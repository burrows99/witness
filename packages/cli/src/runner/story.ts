import {
  changedLinesOf,
  orderEvents,
  sealStory,
  type CoverageLine,
  type NormalisedDiff,
  type ProbeTarget,
  type ResolvedConfig,
  type Story,
  type StoryAssertion,
  type StoryArtifact,
  type StoryDiagnostic,
  type StoryEvent,
  type UnsequencedEvent,
} from '@swe-verify/core'

/**
 * Story assembly.
 *
 * The producer merges the tiers once, into one array with a tier
 * discriminant. Per-tier arrays would force every consumer to re-merge, and
 * every consumer would do it differently (TDD §7.1).
 */

export interface ProbeOutcome {
  target: ProbeTarget
  verified: boolean
  adapterLine?: number
  hits: number
}

export interface AssembleParams {
  runId: string
  planId: string
  planSha256: string
  diff: NormalisedDiff
  /** Recomputed by the gate over the same config-scoped diff. */
  diffHash: string
  config: ResolvedConfig
  vcs: { provider: string; change_id?: string; actor?: string }
  cli: string
  startedAt: Date
  sealedAt: Date
  events: UnsequencedEvent[]
  probes: ProbeOutcome[]
  assertions: StoryAssertion[]
  artifacts: StoryArtifact[]
  diagnostics: StoryDiagnostic[]
  breakpoints?: number
}

/**
 * Coverage is computed against the *diff*, not against the probes: a line the
 * harness failed to instrument at all still has to appear, or a probe that
 * was never planned would silently become a line that was never gated.
 */
export function assembleCoverage(diff: NormalisedDiff, probes: readonly ProbeOutcome[]): Story['coverage'] {
  const byLine = new Map<string, ProbeOutcome>()
  for (const probe of probes) byLine.set(`${probe.target.file}:${probe.target.line}`, probe)

  const lines: CoverageLine[] = []
  for (const changed of changedLinesOf(diff)) {
    const probe = byLine.get(`${changed.file}:${changed.line}`)
    lines.push({
      file: changed.file,
      line: changed.line,
      // An unbound probe is its own class: "we never watched this" is a
      // different failure from "this never ran" (D9).
      class: probe && !probe.verified ? 'unbound' : changed.class,
      ...(probe ? { probe_id: probe.target.id, verified: probe.verified, hits: probe.hits } : { hits: 0 }),
      ...(probe?.adapterLine !== undefined ? { adapter_line: probe.adapterLine } : {}),
    })
  }

  return {
    policy: 'all-executable',
    lines,
    summary: {
      executable: lines.filter((l) => l.class === 'executable').length,
      fired: lines.filter((l) => (l.hits ?? 0) > 0).length,
      unverified: lines.filter((l) => l.verified === false).length,
      waived: lines.filter((l) => l.class === 'waived').length,
      excluded: diff.excludedLines,
      defensive: lines.filter((l) => l.class === 'defensive').length,
    },
  }
}

export function assembleStory(params: AssembleParams): Story {
  // `seq` is assigned here, once, in causal order — so every consumer reads
  // the same story from the same file (TDD §7.1).
  const ordered = orderEvents(params.events.map((event, index) => ({ ...event, seq: index })) as StoryEvent[])
  const events = ordered.map((event, index) => ({ ...event, seq: index + 1 }))

  const story: Story = {
    schema: 'swe-verify/story@1',
    run_id: params.runId,
    plan_id: params.planId,
    plan_sha256: params.planSha256,
    diff: {
      hash: params.diffHash,
      algo: params.diff.algo,
      base_sha: params.diff.baseSha ?? '',
      head_sha: params.diff.headSha ?? '',
      files: params.diff.files.length,
      changed_lines: params.diff.changedLines,
    },
    vcs: params.vcs,
    env: {
      cli: params.cli,
      os: `${process.platform}/${process.arch}`,
      runner: params.config.runner,
      domain: params.config.domain,
      ...(params.breakpoints ? { breakpoints: params.breakpoints } : {}),
    },
    started_at: params.startedAt.toISOString(),
    sealed_at: params.sealedAt.toISOString(),
    events,
    coverage: assembleCoverage(params.diff, params.probes),
    assertions: params.assertions,
    artifacts: params.artifacts,
    diagnostics: params.diagnostics,
  }

  return sealStory(story)
}
