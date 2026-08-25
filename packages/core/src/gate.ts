import { diffHash, type NormalisedDiff } from './diff.js'
import { matchesScope } from './glob.js'
import type {
  Bypass,
  CoverageLine,
  Finding,
  GateCode,
  PlanRef,
  ResolvedConfig,
  Severity,
  Story,
  Waiver,
} from './types.js'

/**
 * The gate — TDD §7.6, contracts §5.
 *
 * A pure function: no I/O, no git shell-out, no host. That is what makes the
 * rule "`core` never imports `vcs`" enforceable rather than aspirational, and
 * what lets the same logic run in CI, in pre-commit and in the L3 mutation
 * harness with no environment at all.
 *
 * `now` and `ci` are passed in for the same reason — a gate that reads the
 * clock or the environment is not reproducible, and the L3 harness needs to
 * replay a verdict exactly.
 */

export interface GateInput {
  /** Already schema-validated, or null when no story was produced. */
  story: Story | null
  diff: NormalisedDiff
  plans: PlanRef[]
  policy: ResolvedConfig
  bypass: Bypass | null
  now?: Date
  ci?: boolean
}

export interface GateMetrics {
  executable: number
  fired: number
  unverified: number
  waived: number
  defensive: number
  assertionsPassed: number
  assertionsTotal: number
}

export interface GateResult {
  verdict: 'allow' | 'block' | 'bypass'
  findings: Finding[]
  metrics: GateMetrics
}

const WAIVER_EXPIRY_WARN_DAYS = 30
const DAY_MS = 86_400_000

const EMPTY_METRICS: GateMetrics = {
  executable: 0, fired: 0, unverified: 0, waived: 0, defensive: 0, assertionsPassed: 0, assertionsTotal: 0,
}

/**
 * Restrict a diff to what the config says is gateable. Both the runner and
 * the gate call this, so the `diff_hash` written into a story and the one
 * recomputed at gate time are over exactly the same thing.
 */
export function gatedDiff(diff: NormalisedDiff, policy: ResolvedConfig): NormalisedDiff {
  const files = diff.files.filter((f) => matchesScope(f.path, policy.scope))
  const changedLines = files.reduce((n, f) => n + f.lines.length, 0)
  return { ...diff, files, changedLines, isEmpty: changedLines === 0 }
}

export function evaluate(input: GateInput): GateResult {
  const now = input.now ?? new Date()
  const ci = input.ci ?? false
  const { policy } = input
  const diff = gatedDiff(input.diff, policy)
  const findings: Finding[] = []
  const add = (code: GateCode, severity: Severity, message: string, remedy: string, locus?: Finding['locus']) => {
    findings.push({ code, severity, message, remedy, ...(locus ? { locus } : {}) })
  }

  // Q7: a diff touching a language with no trustworthy DAP adapter is
  // partially gated, and the ungated part is announced. Refusing silently is
  // the version of this that gets quietly abused.
  for (const file of diff.files) {
    if (!file.unsupportedLanguage) continue
    add(
      'SV016', 'warn',
      `${file.path} is ${file.unsupportedLanguage}, which has no trustworthy debug adapter: ${file.lines.length} changed line(s) are not gated`,
      'Nothing to do here. Support is declared explicitly rather than degraded to log-scraping; cover this file with tests instead.',
      { file: file.path },
    )
  }

  // Nothing gateable changed: a comment-only or formatting-only PR normalises
  // to an empty diff and needs no evidence at all (US-1 AC4), and neither
  // does a change confined to languages we refuse to gate.
  const gateableLines = diff.files.reduce((n, f) => n + (f.unsupportedLanguage ? 0 : f.lines.length), 0)
  if (gateableLines === 0) return finish('allow', findings, EMPTY_METRICS, input, policy)

  // 1. A story exists.
  const story = input.story
  if (!story) {
    add(
      'SV001', 'error',
      `no story for this change (${diff.changedLines} changed line(s) across ${diff.files.length} file(s))`,
      'Run `swe-verify verify --plan <plan>` and attach the resulting story to this change.',
    )
    return finish('block', findings, EMPTY_METRICS, input, policy)
  }

  // 2. The story is about *this* diff. A stale story makes every later check
  //    meaningless, so this short-circuits.
  const expectedHash = diffHash(diff)
  if (story.diff.algo !== diff.algo || story.diff.hash !== expectedHash) {
    add(
      'SV003', 'error',
      story.diff.algo !== diff.algo
        ? `story was normalised by "${story.diff.algo}" but this CLI uses "${diff.algo}"`
        : `stale evidence: story diff_hash ${short(story.diff.hash)} does not match this diff ${short(expectedHash)}`,
      'Re-run `swe-verify verify` against the current head; the code changed after the story was sealed.',
    )
    return finish('block', findings, EMPTY_METRICS, input, policy)
  }

  // 3. The story executed the plan that is in the tree.
  const plan = input.plans.find((p) => p.id === story.plan_id)
  if (!plan) {
    add(
      'SV004', 'error',
      `story ran plan "${story.plan_id}", which is not committed in this tree`,
      'Commit the plan the story executed, or re-run with a plan that is in the tree.',
    )
    return finish('block', findings, EMPTY_METRICS, input, policy)
  }
  if (plan.sha256 !== story.plan_sha256) {
    add(
      'SV004', 'error',
      `plan "${plan.id}" changed after the story was produced (${short(story.plan_sha256)} → ${short(plan.sha256)})`,
      'Re-run `swe-verify verify` so the story reflects the committed plan.',
    )
    return finish('block', findings, EMPTY_METRICS, input, policy)
  }

  // 4. Every changed file is inside some plan's scope. "We never planned to
  //    exercise this" is a different failure from "we ran it and it did not
  //    execute", and gets its own code.
  const inScope = new Set<string>()
  for (const file of diff.files) {
    if (file.unsupportedLanguage) continue
    if (input.plans.some((p) => matchesScope(file.path, p.scope))) inScope.add(file.path)
    else {
      add(
        'SV012', 'error',
        `changed file "${file.path}" is not covered by any committed plan scope`,
        `Add "${file.path}" to a plan's scope.include and re-run, or exclude it in .swe-verify/config.json if it is not gateable.`,
        { file: file.path },
      )
    }
  }

  // 5. Coverage.
  const metrics: GateMetrics = { ...EMPTY_METRICS }
  const byLine = new Map<string, CoverageLine>()
  for (const line of story.coverage.lines) byLine.set(`${line.file}:${line.line}`, line)
  const covered = coveredLines(story.coverage.lines)
  const waivers = input.plans.flatMap((p) => p.waivers ?? [])

  let coverable = 0
  for (const file of diff.files) {
    if (!inScope.has(file.path)) continue
    for (const line of file.lines) {
      const locus = { file: file.path, line: line.line }
      const waiver = findWaiver(waivers, file.path, line.line)
      if (waiver) {
        coverable += 1
        metrics.waived += 1
        const expiry = Date.parse(`${waiver.expires}T00:00:00.000Z`)
        if (Number.isNaN(expiry)) {
          add('SV013', 'error', `waiver for ${file.path}:${line.line} has an unparseable expiry "${waiver.expires}"`,
            'Use an ISO date (YYYY-MM-DD) for the waiver expiry.', locus)
        } else if (expiry <= now.getTime()) {
          add('SV013', 'error', `waiver for ${file.path}:${line.line} expired on ${waiver.expires}: ${waiver.reason}`,
            'Exercise this line, or renew the waiver with a current expiry and a reason that still holds.', locus)
        } else {
          const days = Math.ceil((expiry - now.getTime()) / DAY_MS)
          const soon = days <= WAIVER_EXPIRY_WARN_DAYS
          add('SV013', 'warn',
            `coverage waived for ${file.path}:${line.line} until ${waiver.expires}${soon ? ` (${days} day(s) left)` : ''}: ${waiver.reason}`,
            soon ? 'Exercise this line before the waiver expires, or renew it.' : 'No action needed now; the waiver is recorded and dated.',
            locus)
        }
        continue
      }

      const isDefensive = line.class === 'defensive'
      if (isDefensive && policy.coverage.defensive === 'off') continue
      coverable += 1
      if (isDefensive) metrics.defensive += 1
      else metrics.executable += 1

      const entry = byLine.get(`${file.path}:${line.line}`)

      // "Accepted but never bound" looks identical to "never ran" but has the
      // opposite remedy, so it is a separate code (D9, R2).
      if (entry?.verified === false) {
        metrics.unverified += 1
        add('SV011', 'error',
          `probe on ${file.path}:${line.line} was accepted but never verified — the line was never actually watched`,
          'Run `swe-verify doctor`: this is almost always a path-mapping problem between the container and the repo, or a build without source information.',
          locus)
        continue
      }

      if (covered.has(`${file.path}:${line.line}`)) {
        metrics.fired += 1
        continue
      }

      if (isDefensive && policy.coverage.defensive === 'warn') {
        add('SV014', 'warn',
          `defensive line ${file.path}:${line.line} was never executed`,
          'Add a step that provokes this failure path, or leave it: defensive lines only warn under the default policy.',
          locus)
        continue
      }

      add('SV010', 'error',
        `changed line never executed: ${file.path}:${line.line}`,
        `Add a step to plan "${plan.id}" that reaches ${file.path}:${line.line}, or waive it with a dated reason.`,
        locus)
    }
  }

  // A waiver cap keeps the escape hatch from becoming the gate.
  if (coverable > 0 && policy.coverage.waiverCapPct < 100) {
    const pct = (metrics.waived / coverable) * 100
    if (pct > policy.coverage.waiverCapPct) {
      add('SV015', 'error',
        `${metrics.waived} of ${coverable} gateable lines are waived (${pct.toFixed(0)}%), above the ${policy.coverage.waiverCapPct}% cap`,
        'Exercise some of the waived lines, or raise coverage.waiverCapPct in config if the cap is genuinely wrong for this repo.')
    }
  }

  // 6. Assertions.
  metrics.assertionsTotal = story.assertions.length
  for (const assertion of story.assertions) {
    if (assertion.status === 'pass') { metrics.assertionsPassed += 1; continue }
    if (assertion.status === 'fail') {
      add('SV020', 'error',
        `assertion "${assertion.id}" failed${assertion.diff ? `: ${assertion.diff}` : ''}`,
        'Fix the behaviour, or correct the assertion if the expectation was wrong.',
        { assertion_id: assertion.id })
    }
  }
  if (plan.assertionCount === 0) {
    add('SV021', 'warn',
      `plan "${plan.id}" has no assertions: the run proves the code was exercised, not that it behaved`,
      'Add at least one assertion so a green gate means something.')
  }

  // Harness policy.
  if (ci && (story.env.breakpoints ?? 0) > 0) {
    add('SV040', 'error',
      `story used ${story.env.breakpoints} suspending breakpoint(s); breakpoints are disallowed in CI`,
      'Use logpoints (the default). Breakpoints are a local-only escape hatch because a suspended process cannot be observed mid-request.')
  }
  const duration = durationMs(story)
  if (duration !== null && duration > policy.budgets.runMs) {
    add('SV041', 'error',
      `run took ${Math.round(duration / 1000)}s, over the ${Math.round(policy.budgets.runMs / 1000)}s budget`,
      'Narrow the plan scope or raise budgets.runMs; a gate that takes longer than the budget gets routed around.')
  }
  if (policy.artifacts.requireAgentReadable) {
    for (const event of story.events) {
      if (event.type !== 'step' || event.step_seq === undefined) continue
      const readable = story.artifacts.some((a) => a.step_seq === event.step_seq && a.readableBy.includes('agent'))
      if (!readable) {
        add('SV030', 'error',
          `step ${event.step_seq} produced no agent-readable artefact`,
          'Enable a recorder that emits an agent-readable artefact (a11y snapshot, transcript, row dump) for this step.',
          { step_seq: event.step_seq })
      }
    }
  }

  const verdict = findings.some((f) => f.severity === 'error') ? 'block' : 'allow'
  return finish(verdict, findings, metrics, input, policy)
}

/**
 * Bypass is resolved outside `core` by the VcsProvider and arrives as data.
 * It is amber, never green: the findings it skipped stay in the result so a
 * reviewer sees what was waved through.
 */
function finish(
  verdict: 'allow' | 'block',
  findings: Finding[],
  metrics: GateMetrics,
  input: GateInput,
  policy: ResolvedConfig,
): GateResult {
  const sorted = sortFindings(findings)
  if (verdict === 'block' && input.bypass) {
    const reason = input.bypass.reason?.trim() ?? ''
    const allowed = policy.bypass.allowed && (!policy.bypass.requiresReason || reason.length > 0)
    if (allowed) {
      return {
        verdict: 'bypass',
        findings: sortFindings([
          ...findings,
          {
            code: 'SV090',
            severity: 'warn',
            message: `gate bypassed by ${input.bypass.actor ?? 'unknown'}: ${reason}`,
            remedy: 'None required. This bypass is recorded and published; bypass rate is tracked over time.',
          },
        ]),
        metrics,
      }
    }
  }
  return { verdict, findings: sorted, metrics }
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warn: 1 }

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    a.code.localeCompare(b.code) ||
    (a.locus?.file ?? '').localeCompare(b.locus?.file ?? '') ||
    (a.locus?.line ?? 0) - (b.locus?.line ?? 0) ||
    (a.locus?.step_seq ?? 0) - (b.locus?.step_seq ?? 0) ||
    (a.locus?.assertion_id ?? '').localeCompare(b.locus?.assertion_id ?? ''))
}

/**
 * Which lines the story actually exercised. A probe that the adapter slid to
 * the next executable statement covers the span between the requested and the
 * bound line; without this, the requested line reports unfired forever
 * (contracts §7).
 */
function coveredLines(lines: readonly CoverageLine[]): Set<string> {
  const covered = new Set<string>()
  for (const line of lines) {
    if ((line.hits ?? 0) <= 0) continue
    const from = Math.min(line.line, line.adapter_line ?? line.line)
    const to = Math.max(line.line, line.adapter_line ?? line.line)
    for (let n = from; n <= to; n += 1) covered.add(`${line.file}:${n}`)
  }
  return covered
}

function findWaiver(waivers: readonly Waiver[], file: string, line: number): Waiver | null {
  for (const waiver of waivers) {
    if (waiver.file !== file) continue
    const [fromRaw, toRaw] = waiver.lines.split('-')
    const from = Number(fromRaw)
    const to = toRaw === undefined ? from : Number(toRaw)
    if (Number.isFinite(from) && line >= from && line <= to) return waiver
  }
  return null
}

function durationMs(story: Story): number | null {
  if (!story.sealed_at) return null
  const started = Date.parse(story.started_at)
  const sealed = Date.parse(story.sealed_at)
  if (Number.isNaN(started) || Number.isNaN(sealed)) return null
  return sealed - started
}

function short(hash: string): string {
  return hash.startsWith('sha256:') ? `${hash.slice(0, 15)}…` : hash
}
