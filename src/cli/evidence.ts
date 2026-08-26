import { readString, type Plan, type PlanArgs, type PlanStep } from '../core/index.js'
import type { Slide } from '../recorders/index.js'

/**
 * Recording, as a property of a run.
 *
 * A recording of the working state proves nothing on its own — a reader cannot
 * tell a fix from a film of a healthy system. What convinces is a pair: the bug
 * reproduced, then the same flow after the change.
 *
 * The tool does not orchestrate that pair, because it does not need to and
 * should not try. Which recording you get is decided by what is checked out:
 * film `main` and you have the reproduction, film the branch and you have the
 * fix. Reverting files to synthesise a "before" would mutate a working tree
 * mid-run and could leave a half-reverted state that never existed.
 *
 * So the job here is narrower and safer: make every recording say what it
 * filmed, so two files can be told apart without a caption from the author.
 */

/** Where the recording was taken from. */
export interface GitState {
  branch: string
  sha: string
  dirty: boolean
}

/**
 * Rules a recording has to obey. Written down because each one comes from a
 * recording that misled somebody.
 */
export const EVIDENCE_RULES = [
  'A run that records nothing fails. A green result with no video is the failure recording exists to prevent.',
  'A caption narrates what the frame renders. A value that was measured and which the app does not draw belongs in the probe dock, which says MEASURED on its face.',
  'A reproduction must not end on the working state: the same plan runs against both builds, so a reconciling final beat makes the pair indistinguishable at the frame a reviewer scrubs to.',
  'A recording taken from a dirty tree is not reproducible from its commit, and says so on the card.',
] as const

/** A filename that cannot collide between two checkouts of the same plan. */
export function recordingLabel(plan: Plan, git: GitState): string {
  const parts = [slug(plan.id), slug(git.branch), git.sha.slice(0, 7)].filter(Boolean)
  return `${parts.join('-')}${git.dirty ? '-dirty' : ''}`
}

/** The title card the recording opens on. */
export function recordingSlide(plan: Plan, git: GitState): Slide {
  const watch = plan.assertions
    .map((assertion) => {
      const expected: PlanArgs = assertion.expect
      for (const key of ['visible', 'equals', 'contains', 'status']) {
        if (expected[key] === undefined) continue
        // A plan is hand-written JSON; an object here is a mistake in the plan,
        // and printing "[object Object]" onto a title card would hide it.
        return `${assertion.kind}: ${scalar(expected, key)}`
      }
      return ''
    })
    .filter(Boolean)
    .join(' · ')

  const where = `${git.branch || 'detached'} @ ${git.sha.slice(0, 7)}`
  const detail = git.dirty
    ? `Recorded on ${where}, with uncommitted changes in the tree — this film is not reproducible from that commit alone.`
    : `Recorded on ${where}.`

  return {
    title: plan.intent,
    detail,
    ...(git.branch ? { group: git.branch } : {}),
    ...(watch ? { watch } : {}),
  }
}

/**
 * The plan as it is filmed: the original steps, narrated, held at the end.
 *
 * Captions are inserted as ordinary plan steps rather than harness code, which
 * is what keeps this project-agnostic — a repository gets narrated evidence
 * from its plan JSON without writing a driver.
 */
export function narratePlan(plan: Plan): Plan {
  if (!plan.steps.some((step) => step.driver === 'web')) return plan

  const steps: PlanStep[] = []
  const remap = new Map<number, number>()
  let seq = 1

  for (const step of [...plan.steps].sort((a, b) => a.seq - b.seq)) {
    // A plan that captions itself is left to say what it meant to say.
    if (step.driver === 'web' && !NARRATION.has(step.action)) {
      steps.push({ seq: seq++, driver: 'web', action: 'caption', args: { text: describeStep(step) } })
    }
    const renumbered = { ...step, seq: seq++ }
    steps.push(renumbered)
    remap.set(step.seq, renumbered.seq)
  }

  // A recording that cuts the instant the last action completes ends before a
  // viewer has read the last caption.
  steps.push({ seq, driver: 'web', action: 'beat', args: { ms: 2200 } })

  return {
    ...plan,
    steps,
    assertions: plan.assertions.map((assertion) => ({
      ...assertion,
      afterStep: remap.get(assertion.afterStep) ?? assertion.afterStep,
    })),
  }
}

const NARRATION = new Set(['caption', 'probe', 'beat'])

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** A scalar from a plan, or a visible complaint if the plan put an object there. */
function scalar(args: PlanArgs, key: string, fallback = ''): string {
  try {
    return readString(args, key, fallback)
  } catch {
    return `<${key}: not a value>`
  }
}

function describeStep(step: PlanStep): string {
  const args: PlanArgs = step.args ?? {}
  const target = ['name', 'label', 'text', 'path', 'selector']
    .map((key) => (typeof args[key] === 'string' ? (args[key]) : ''))
    .find((value) => value.length > 0)

  switch (step.action) {
    case 'goto': return `Open ${target ?? '/'}`
    case 'click': return `Click ${target ?? 'the control'}`
    case 'fill': return `Enter ${scalar(args, 'value')} in ${target ?? 'the field'}`
    case 'waitFor': return `Wait for ${target ?? 'the page'}`
    default: return `${step.action} ${target ?? ''}`.trim()
  }
}
