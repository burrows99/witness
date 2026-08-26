import { describe, expect, it } from 'vitest'
import { narratePlan, recordingLabel, recordingSlide, EVIDENCE_RULES } from '../../../src/cli/evidence.js'
import type { Plan } from '../../../src/core/index.js'

/**
 * Recording is a property of a run, not a workflow the CLI orchestrates.
 *
 * Whether a recording is the reproduction or the fix is decided by what is
 * checked out — film `main` and you have the bug, film the branch and you have
 * the fix. The tool's job is to make each recording say which it was, so a
 * reviewer looking at two files can tell them apart without being told.
 */

const plan = (over: Partial<Plan> = {}): Plan => ({
  schema: 'witness/plan@1',
  id: 'checkout',
  intent: 'placing an order shows a confirmation',
  scope: { include: ['src/**'] },
  steps: [
    { seq: 1, driver: 'web', action: 'goto', args: { path: '/' } },
    { seq: 2, driver: 'web', action: 'click', args: { role: 'button', name: 'Place order' } },
    { seq: 3, driver: 'web', action: 'waitFor', args: { text: 'Order confirmed' } },
  ],
  assertions: [{ id: 'a1', kind: 'ui-text', afterStep: 3, expect: { visible: 'Order confirmed' } }],
  ...over,
})

const git = { branch: 'fix/expire-ctx', sha: '5878f547abc', dirty: false }

describe('recordingLabel — the file says what it filmed', () => {
  it('names the plan and the branch, so two recordings never collide', () => {
    expect(recordingLabel(plan(), git)).toBe('checkout-fix-expire-ctx-5878f54')
  })

  it('slugifies a branch name that is not filename-safe', () => {
    expect(recordingLabel(plan(), { ...git, branch: 'feat/Thing #12' })).toMatch(/^checkout-feat-thing-12-[0-9a-f]{7}$/)
  })

  it('marks a dirty tree, because that recording is not reproducible from the sha', () => {
    expect(recordingLabel(plan(), { ...git, dirty: true })).toMatch(/-dirty$/)
  })

  it('copes with a detached head that has no branch name', () => {
    expect(recordingLabel(plan(), { ...git, branch: '' })).toMatch(/^checkout-[0-9a-f]{7}/)
  })
})

describe('recordingSlide — the card a viewer opens on', () => {
  it('leads with what the plan set out to prove', () => {
    expect(recordingSlide(plan(), git).title).toMatch(/placing an order shows a confirmation/)
  })

  it('states the branch and commit it was filmed on', () => {
    const card = recordingSlide(plan(), git)
    expect(card.detail).toMatch(/fix\/expire-ctx/)
    expect(card.detail).toMatch(/5878f54/)
  })

  it('groups by branch, so a pair of recordings is visibly a pair', () => {
    expect(recordingSlide(plan(), git).group).toBe('fix/expire-ctx')
  })

  it('says what to watch for, taken from the plan\'s assertions', () => {
    expect(recordingSlide(plan(), git).watch).toMatch(/Order confirmed/)
  })

  it('warns on the card when the tree was dirty', () => {
    expect(recordingSlide(plan(), { ...git, dirty: true }).detail).toMatch(/uncommitted/i)
  })

  it('never writes "undefined" onto the card when a plan asserts nothing', () => {
    expect(JSON.stringify(recordingSlide(plan({ assertions: [] }), git))).not.toMatch(/undefined/)
  })
})

describe('narratePlan — the run is filmed with captions', () => {
  it('keeps every original step, in order', () => {
    const filmed = narratePlan(plan())
    const original = plan().steps.map((s) => `${s.driver}:${s.action}`)
    expect(filmed.steps.filter((s) => original.includes(`${s.driver}:${s.action}`)).map((s) => `${s.driver}:${s.action}`))
      .toEqual(original)
  })

  it('renumbers so seq stays the join key into the story', () => {
    const seqs = narratePlan(plan()).steps.map((s) => s.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(new Set(seqs).size).toBe(seqs.length)
  })

  it('moves each assertion onto the step it was anchored to', () => {
    const filmed = narratePlan(plan())
    expect(filmed.assertions[0]!.afterStep).toBe(filmed.steps.find((s) => s.action === 'waitFor')!.seq)
  })

  it('keeps the assertions — a recording still has to prove something', () => {
    expect(narratePlan(plan()).assertions).toHaveLength(1)
  })

  it('holds the final frame, so the recording does not cut mid-sentence', () => {
    expect(narratePlan(plan()).steps.at(-1)!.action).toBe('beat')
  })

  it('leaves a plan with no browser steps alone rather than captioning an API run', () => {
    const api = plan({ steps: [{ seq: 1, driver: 'api', action: 'get', args: { path: '/' } }] })
    expect(narratePlan(api)).toEqual(api)
  })

  it('does not caption a caption', () => {
    const already = plan({ steps: [{ seq: 1, driver: 'web', action: 'caption', args: { text: 'mine' } }] })
    expect(narratePlan(already).steps.filter((s) => s.action === 'caption')).toHaveLength(1)
  })
})

describe('the rules a recording has to obey', () => {
  it('states them, so they can be quoted in a review', () => {
    const text = EVIDENCE_RULES.join(' ').toLowerCase()
    expect(text).toMatch(/records nothing/)
    expect(text).toMatch(/measured/)
  })
})
