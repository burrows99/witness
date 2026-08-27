import { describe, expect, it } from 'vitest'
import { evaluate } from '../../../src/core/gate.js'
import { normaliseDiff, diffHash } from '../../../src/core/diff.js'
import { NOW, coverageFor, diffOf, planRef, policyOf, storyFor } from '../../helpers/core/build.js'
import type { GateInput } from '../../../src/core/gate.js'

const input = (over: Partial<GateInput> = {}): GateInput => {
  const diff = over.diff ?? diffOf()
  return {
    story: over.story === undefined ? storyFor(diff) : over.story,
    diff,
    plans: over.plans ?? [planRef()],
    policy: over.policy ?? policyOf(),
    bypass: over.bypass ?? null,
    now: over.now ?? NOW,
    ci: over.ci ?? false,
    ...(over.instrumentable ? { instrumentable: over.instrumentable } : {}),
  }
}
const codes = (r: { findings: Array<{ code: string }> }) => r.findings.map((f) => f.code)

describe('gate — the happy path', () => {
  it('allows a change whose every executable line fired and whose assertions passed', () => {
    const r = evaluate(input())
    expect(r.verdict).toBe('allow')
    expect(r.findings.filter((f) => f.severity === 'error')).toEqual([])
    expect(r.metrics).toMatchObject({ executable: 2, fired: 2, unverified: 0, waived: 0, assertionsPassed: 1, assertionsTotal: 1 })
  })

  it('allows a comment-only change with no story at all (US-1 AC4)', () => {
    const diff = normaliseDiff(['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1,0 +1,2 @@', '+// just a note', '+'].join('\n'))
    const r = evaluate(input({ diff, story: null, plans: [] }))
    expect(r.verdict).toBe('allow')
    expect(r.findings).toEqual([])
  })

  it('every finding carries a remedy (US-7 AC2)', () => {
    const r = evaluate(input({ story: null }))
    expect(r.findings.length).toBeGreaterThan(0)
    for (const f of r.findings) expect(f.remedy.length).toBeGreaterThan(10)
  })
})

describe('gate — SV001 no story (FR-1)', () => {
  it('blocks a real change with no story', () => {
    const r = evaluate(input({ story: null }))
    expect(r.verdict).toBe('block')
    expect(codes(r)).toEqual(['SV001'])
  })
})

describe('gate — SV003 stale evidence (FR-2)', () => {
  it('blocks when the story diff_hash does not match the diff', () => {
    const diff = diffOf()
    const story = storyFor(diff)
    story.diff.hash = `sha256:${'0'.repeat(64)}`
    const r = evaluate(input({ diff, story }))
    expect(r.verdict).toBe('block')
    expect(codes(r)).toContain('SV003')
  })

  it('short-circuits: a stale story is not also reported as uncovered', () => {
    const diff = diffOf()
    const story = storyFor(diff, {}, [])
    story.diff.hash = `sha256:${'0'.repeat(64)}`
    expect(codes(evaluate(input({ diff, story })))).toEqual(['SV003'])
  })

  it('blocks when the story was normalised by a different algorithm', () => {
    const diff = diffOf()
    const story = storyFor(diff)
    story.diff.algo = 'normalised-v2'
    expect(codes(evaluate(input({ diff, story })))).toContain('SV003')
  })

  it('stays fresh across a rebase — base and head sha do not enter the hash', () => {
    const diff = diffOf()
    const story = storyFor(diff)
    const rebased = { ...diff, baseSha: 'f'.repeat(40), headSha: '1'.repeat(40) }
    expect(diffHash(rebased)).toBe(story.diff.hash)
    expect(evaluate(input({ diff: rebased, story })).verdict).toBe('allow')
  })
})

describe('gate — SV004 story ran a different plan (FR-4)', () => {
  it('blocks when the committed plan hash does not match the story', () => {
    const diff = diffOf()
    const story = storyFor(diff)
    const r = evaluate(input({ diff, story, plans: [planRef({ sha256: `sha256:${'b'.repeat(64)}` })] }))
    expect(r.verdict).toBe('block')
    expect(codes(r)).toContain('SV004')
  })

  it('blocks when the story names a plan that is not in the tree', () => {
    const diff = diffOf()
    const story = storyFor(diff, { plan_id: 'ghost' })
    expect(codes(evaluate(input({ diff, story })))).toContain('SV004')
  })
})

describe('gate — SV012 out-of-scope change', () => {
  it('blocks a changed file no plan scope covers', () => {
    const diff = diffOf('server/orders.go', ['x := 1', 'return x'])
    const story = storyFor(diff)
    const r = evaluate(input({ diff, story, plans: [planRef({ scope: { include: ['src/**'] } })] }))
    expect(r.verdict).toBe('block')
    expect(codes(r)).toContain('SV012')
    expect(r.findings.find((f) => f.code === 'SV012')!.locus!.file).toBe('server/orders.go')
  })

  it('honours a plan scope exclude', () => {
    const diff = diffOf('src/pricing/discount.stories.tsx')
    const story = storyFor(diff)
    const r = evaluate(input({ diff, story, plans: [planRef({ scope: { include: ['src/**'], exclude: ['**/*.stories.tsx'] } })] }))
    expect(codes(r)).toContain('SV012')
  })

  it('accepts a file covered by the second of several plans', () => {
    const diff = diffOf('server/orders.go', ['x := 1', 'return x'])
    const story = storyFor(diff)
    const plans = [planRef({ id: 'p1', scope: { include: ['src/**'] } }), planRef({ id: 'checkout-discount', scope: { include: ['server/**'] } })]
    expect(codes(evaluate(input({ diff, story, plans })))).not.toContain('SV012')
  })

  it('does not gate a file the config scope excludes', () => {
    const diff = diffOf('src/pricing/discount.test.ts')
    const r = evaluate(input({ diff, story: null, plans: [] }))
    expect(r.verdict).toBe('allow')
  })
})

describe('gate — SV010 unexercised vs SV011 unobserved (FR-10, FR-11, D9)', () => {
  it('blocks a changed line whose probe never fired, naming file and line', () => {
    const diff = diffOf()
    const lines = coverageFor(diff)
    lines[1]!.hits = 0
    const r = evaluate(input({ diff, story: storyFor(diff, {}, lines) }))
    expect(r.verdict).toBe('block')
    const f = r.findings.find((x) => x.code === 'SV010')!
    expect(f.locus).toMatchObject({ file: 'src/pricing/discount.ts', line: 41 })
    expect(f.remedy).toMatch(/waive|step|reach/i)
  })

  it('uses a different code when the probe was accepted but never verified', () => {
    const diff = diffOf()
    const lines = coverageFor(diff)
    lines[0]!.verified = false
    lines[0]!.hits = 0
    const r = evaluate(input({ diff, story: storyFor(diff, {}, lines) }))
    expect(codes(r)).toContain('SV011')
    expect(codes(r)).not.toContain('SV010')
    expect(r.findings.find((f) => f.code === 'SV011')!.remedy).toMatch(/path mapping|doctor/i)
  })

  it('blocks a line the story never mentions at all', () => {
    const diff = diffOf()
    const r = evaluate(input({ diff, story: storyFor(diff, {}, []) }))
    expect(codes(r)).toContain('SV010')
    expect(r.findings.filter((f) => f.code === 'SV010')).toHaveLength(2)
  })

  it('counts a slid probe as covering the span it moved across (contracts §7)', () => {
    const diff = diffOf('src/a.ts', ['const a = 1', 'const b = 2'])
    const lines = coverageFor(diff)
    lines[0]!.adapter_line = 41
    lines[0]!.hits = 2
    lines[1]!.hits = 0
    delete lines[1]!.probe_id
    const r = evaluate(input({ diff, story: storyFor(diff, {}, lines), plans: [planRef({ scope: { include: ['src/**'] } })] }))
    expect(codes(r)).not.toContain('SV010')
  })

  it('reports one finding per unexercised line, not one per file', () => {
    const diff = diffOf()
    const lines = coverageFor(diff).map((l) => ({ ...l, hits: 0 }))
    expect(evaluate(input({ diff, story: storyFor(diff, {}, lines) })).findings.filter((f) => f.code === 'SV010')).toHaveLength(2)
  })
})

describe('gate — defensive lines (SV014, policy)', () => {
  const defensiveDiff = () => diffOf('src/a.ts', ['const a = 1', 'throw new Error("bad")'])

  it('warns but does not block under the default warn policy', () => {
    const diff = defensiveDiff()
    const lines = coverageFor(diff)
    lines[1]!.hits = 0
    const r = evaluate(input({ diff, story: storyFor(diff, {}, lines), plans: [planRef({ scope: { include: ['src/**'] } })] }))
    expect(r.verdict).toBe('allow')
    expect(codes(r)).toContain('SV014')
    expect(r.findings.find((f) => f.code === 'SV014')!.severity).toBe('warn')
  })

  it('says nothing at all under policy off', () => {
    const diff = defensiveDiff()
    const lines = coverageFor(diff)
    lines[1]!.hits = 0
    const policy = policyOf({ coverage: { policy: 'all-executable', defensive: 'off', waiverCapPct: 10 } })
    const r = evaluate(input({ diff, story: storyFor(diff, {}, lines), policy, plans: [planRef({ scope: { include: ['src/**'] } })] }))
    expect(codes(r)).not.toContain('SV014')
    expect(r.verdict).toBe('allow')
  })

  it('blocks under policy require', () => {
    const diff = defensiveDiff()
    const lines = coverageFor(diff)
    lines[1]!.hits = 0
    const policy = policyOf({ coverage: { policy: 'all-executable', defensive: 'require', waiverCapPct: 10 } })
    const r = evaluate(input({ diff, story: storyFor(diff, {}, lines), policy, plans: [planRef({ scope: { include: ['src/**'] } })] }))
    expect(r.verdict).toBe('block')
    expect(codes(r)).toContain('SV010')
  })

  it('an exercised defensive line raises nothing', () => {
    const diff = defensiveDiff()
    const r = evaluate(input({ diff, story: storyFor(diff), plans: [planRef({ scope: { include: ['src/**'] } })] }))
    expect(codes(r)).not.toContain('SV014')
  })
})

describe('gate — waivers (FR-12)', () => {
  const waived = (over = {}) => planRef({ waivers: [{ file: 'src/pricing/discount.ts', lines: '40-41', reason: 'OOM guard', expires: '2026-12-01', ...over }] })

  // The cap is exercised separately below; these cases isolate waiver
  // semantics by turning it off.
  const noCap = policyOf({ coverage: { policy: 'all-executable', defensive: 'warn', waiverCapPct: 100 } })

  it('does not block on an unexercised but validly waived line', () => {
    const diff = diffOf()
    const lines = coverageFor(diff).map((l) => ({ ...l, hits: 0 }))
    const r = evaluate(input({ diff, story: storyFor(diff, {}, lines), plans: [waived()], policy: noCap }))
    expect(r.verdict).toBe('allow')
    expect(codes(r)).not.toContain('SV010')
    expect(r.metrics.waived).toBe(2)
  })

  it('still reports waived lines so they are visible, not silent', () => {
    const diff = diffOf()
    const lines = coverageFor(diff).map((l) => ({ ...l, hits: 0 }))
    const r = evaluate(input({ diff, story: storyFor(diff, {}, lines), plans: [waived()], policy: noCap }))
    expect(r.findings.some((f) => f.severity === 'warn')).toBe(true)
  })

  it('blocks with SV013 once the waiver has expired', () => {
    const diff = diffOf()
    const lines = coverageFor(diff).map((l) => ({ ...l, hits: 0 }))
    const r = evaluate(input({ diff, story: storyFor(diff, {}, lines), plans: [waived({ expires: '2026-08-01' })] }))
    expect(r.verdict).toBe('block')
    expect(codes(r)).toContain('SV013')
  })

  it('warns 30 days before expiry', () => {
    const diff = diffOf()
    const lines = coverageFor(diff).map((l) => ({ ...l, hits: 0 }))
    const r = evaluate(input({ diff, story: storyFor(diff, {}, lines), plans: [waived({ expires: '2026-09-10' })], policy: noCap }))
    expect(r.verdict).toBe('allow')
    expect(r.findings.some((f) => f.code === 'SV013' && f.severity === 'warn')).toBe(true)
  })

  it('accepts a single-line waiver as well as a range', () => {
    const diff = diffOf()
    const lines = coverageFor(diff)
    lines[0]!.hits = 0
    const r = evaluate(input({ diff, story: storyFor(diff, {}, lines), plans: [waived({ lines: '40' })] }))
    expect(codes(r)).not.toContain('SV010')
  })

  it('blocks when waivers exceed the configured cap on the diff', () => {
    const diff = diffOf()
    const lines = coverageFor(diff).map((l) => ({ ...l, hits: 0 }))
    const policy = policyOf({ coverage: { policy: 'all-executable', defensive: 'warn', waiverCapPct: 10 } })
    const r = evaluate(input({ diff, story: storyFor(diff, {}, lines), plans: [waived()], policy }))
    expect(r.verdict).toBe('block')
    expect(codes(r)).toContain('SV015')
  })

  it('a waiver for another file does not silence this one', () => {
    const diff = diffOf()
    const lines = coverageFor(diff).map((l) => ({ ...l, hits: 0 }))
    const r = evaluate(input({ diff, story: storyFor(diff, {}, lines), plans: [planRef({ waivers: [{ file: 'src/other.ts', lines: '40-41', reason: 'x', expires: '2026-12-01' }] })] }))
    expect(codes(r)).toContain('SV010')
  })
})

describe('gate — assertions (FR-3)', () => {
  it('blocks on a failed assertion and names it', () => {
    const diff = diffOf()
    const story = storyFor(diff, {}, coverageFor(diff), [
      { id: 'a1', status: 'pass' },
      { id: 'a2', status: 'fail', diff: 'total: expected 42.00, got 46.20' },
    ])
    const r = evaluate(input({ diff, story }))
    expect(r.verdict).toBe('block')
    const f = r.findings.find((x) => x.code === 'SV020')!
    expect(f.locus!.assertion_id).toBe('a2')
    expect(f.message).toMatch(/46.20/)
    expect(r.metrics).toMatchObject({ assertionsPassed: 1, assertionsTotal: 2 })
  })

  it('warns when a plan proves nothing (SV021)', () => {
    const diff = diffOf()
    const r = evaluate(input({ diff, story: storyFor(diff, {}, coverageFor(diff), []), plans: [planRef({ assertionCount: 0 })] }))
    expect(r.verdict).toBe('allow')
    expect(r.findings.find((f) => f.code === 'SV021')!.severity).toBe('warn')
  })

  it('treats a skipped assertion as not passed', () => {
    const diff = diffOf()
    const story = storyFor(diff, {}, coverageFor(diff), [{ id: 'a1', status: 'skipped' }])
    const r = evaluate(input({ diff, story }))
    expect(r.metrics.assertionsPassed).toBe(0)
  })
})

describe('gate — bypass (FR-6, US-6)', () => {
  it('turns a block into an amber bypass and records the reason', () => {
    const r = evaluate(input({ story: null, bypass: { reason: 'gate is wrong about generated code', actor: 'burrows99' } }))
    expect(r.verdict).toBe('bypass')
    const f = r.findings.find((x) => x.code === 'SV090')!
    expect(f.message).toMatch(/gate is wrong/)
    expect(f.severity).toBe('warn')
  })

  it('keeps the findings it bypassed, so the reviewer sees what was skipped', () => {
    const r = evaluate(input({ story: null, bypass: { reason: 'because' } }))
    expect(codes(r)).toContain('SV001')
  })

  it('refuses a bypass with no reason when the policy requires one', () => {
    const r = evaluate(input({ story: null, bypass: { reason: '   ' } }))
    expect(r.verdict).toBe('block')
    expect(codes(r)).not.toContain('SV090')
  })

  it('refuses a bypass when the policy disallows bypassing', () => {
    const policy = policyOf({ bypass: { allowed: false, requiresReason: true, label: 'x' } })
    const r = evaluate(input({ story: null, bypass: { reason: 'let me through' }, policy }))
    expect(r.verdict).toBe('block')
  })

  it('does not turn an allow into a bypass', () => {
    expect(evaluate(input({ bypass: { reason: 'not needed' } })).verdict).toBe('allow')
  })
})

describe('gate — harness policy findings', () => {
  it('blocks a breakpoint used in CI (SV040)', () => {
    const diff = diffOf()
    const story = storyFor(diff)
    story.env.breakpoints = 1
    expect(codes(evaluate(input({ diff, story, ci: true })))).toContain('SV040')
  })

  it('permits a breakpoint locally', () => {
    const diff = diffOf()
    const story = storyFor(diff)
    story.env.breakpoints = 1
    expect(codes(evaluate(input({ diff, story, ci: false })))).not.toContain('SV040')
  })

  it('blocks a run that exceeded the time budget (SV041)', () => {
    const diff = diffOf()
    const story = storyFor(diff, { started_at: '2026-08-24T10:00:00.000Z', sealed_at: '2026-08-24T10:20:00.000Z' })
    expect(codes(evaluate(input({ diff, story })))).toContain('SV041')
  })

  it('requires an agent-readable artefact for every step (FR-15)', () => {
    const diff = diffOf()
    const story = storyFor(diff, {
      artifacts: [{ kind: 'video', path: 'v.webm', sha256: `sha256:${'1'.repeat(64)}`, bytes: 10, readableBy: ['human'], step_seq: 1 }],
      events: [{ seq: 1, tier: 'browser', trace_id: 't', wall: 'w', mono_ns: 1, type: 'step', driver: 'web', action: 'click', args: {}, status: 'ok', step_seq: 1 }],
    })
    // A video the agent cannot watch does not satisfy the gate.
    expect(codes(evaluate(input({ diff, story })))).toContain('SV030')

    const withSnapshot = storyFor(diff, {
      artifacts: [
        { kind: 'video', path: 'v.webm', sha256: `sha256:${'1'.repeat(64)}`, bytes: 10, readableBy: ['human'], step_seq: 1 },
        { kind: 'snapshot', path: 'a.yaml', sha256: `sha256:${'2'.repeat(64)}`, bytes: 10, readableBy: ['agent'], step_seq: 1 },
      ],
      events: story.events,
    })
    expect(codes(evaluate(input({ diff, story: withSnapshot })))).not.toContain('SV030')

    const off = policyOf({ artifacts: { requireAgentReadable: false } })
    expect(codes(evaluate(input({ diff, story, policy: off })))).not.toContain('SV030')
  })
})

describe('gate — purity', () => {
  it('does not mutate its inputs', () => {
    const diff = diffOf()
    const story = storyFor(diff)
    const before = JSON.stringify({ diff, story })
    evaluate(input({ diff, story }))
    expect(JSON.stringify({ diff, story })).toBe(before)
  })

  it('is deterministic across repeated evaluation', () => {
    const i = input({ story: storyFor(diffOf(), {}, []) })
    expect(JSON.stringify(evaluate(i))).toBe(JSON.stringify(evaluate(i)))
  })

  it('orders findings by severity then by locus, so output is stable', () => {
    const diff = diffOf('src/a.ts', ['const a = 1', 'const b = 2', 'const c = 3'])
    const lines = coverageFor(diff).map((l) => ({ ...l, hits: 0 }))
    const r = evaluate(input({ diff, story: storyFor(diff, {}, lines), plans: [planRef({ scope: { include: ['src/**'] } })] }))
    expect(r.findings.map((f) => f.locus?.line)).toEqual([40, 41, 42])
  })
})

describe('gate — unsupported languages (Q7: partial gate, loudly)', () => {
  const rubyDiff = () => normaliseDiff(['diff --git a/app/b.rb b/app/b.rb', '--- a/app/b.rb', '+++ b/app/b.rb', '@@ -1,0 +1,1 @@', '+total = total * 2'].join('\n'))

  it('does not block a change it cannot gate, but says so once per file', () => {
    const diff = rubyDiff()
    const r = evaluate(input({ diff, story: null, plans: [planRef({ scope: { include: ['app/**'] } })] }))
    expect(r.verdict).toBe('allow')
    const finding = r.findings.find((f) => f.code === 'SV016')!
    expect(finding.severity).toBe('warn')
    expect(finding.message).toMatch(/ruby/)
    expect(finding.locus!.file).toBe('app/b.rb')
  })

  it('still gates the supported half of a mixed change', () => {
    const mixed = normaliseDiff([
      'diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,0 +1,1 @@', '+const a = 1',
      'diff --git a/app/b.rb b/app/b.rb', '--- a/app/b.rb', '+++ b/app/b.rb', '@@ -1,0 +1,1 @@', '+b = 2',
    ].join('\n'))
    const r = evaluate(input({ diff: mixed, story: null, plans: [planRef({ scope: { include: ['**'] } })] }))
    expect(r.verdict).toBe('block')
    expect(codes(r)).toContain('SV001')
    expect(codes(r)).toContain('SV016')
  })

  it('does not demand plan scope coverage for a file it will not gate', () => {
    const diff = rubyDiff()
    const r = evaluate(input({ diff, story: null, plans: [planRef({ scope: { include: ['src/**'] } })] }))
    expect(codes(r)).not.toContain('SV012')
  })
})

describe('an empty diff still reports a failed assertion', () => {
  /**
   * A comment-only change normalises to an empty diff and needs no coverage
   * evidence, so the gate returns early. It used to return early *before*
   * reading the story's assertions — so a plan that ran, asserted something
   * about behaviour and failed came back `allow` with `assertionsTotal: 0`.
   * The gate reported "merge" on a run that had just proved the behaviour
   * was broken.
   *
   * Coverage is a claim about the diff. An assertion is a claim about the
   * system, and its failure survives the diff being empty.
   */
  const commentOnly = () => normaliseDiff([
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,1 +1,2 @@',
    ' const a = 1',
    '+// explain why',
  ].join('\n'))

  const withAssertions = (assertions: Array<{ id: string; status: 'pass' | 'fail'; diff?: string }>) => {
    const diff = commentOnly()
    return storyFor(diff, {}, [], assertions)
  }

  it('blocks when the story carries a failed assertion', () => {
    const diff = commentOnly()
    const result = evaluate(input({ diff, story: withAssertions([{ id: 'a1', status: 'fail', diff: 'expected "PASS"' }]) }))
    expect(result.verdict).toBe('block')
    expect(codes(result)).toContain('SV020')
  })

  it('counts the assertions it read, rather than reporting none', () => {
    const diff = commentOnly()
    const result = evaluate(input({ diff, story: withAssertions([{ id: 'a1', status: 'pass' }, { id: 'a2', status: 'fail' }]) }))
    expect(result.metrics.assertionsTotal).toBe(2)
    expect(result.metrics.assertionsPassed).toBe(1)
  })

  it('still allows an empty diff whose assertions all passed', () => {
    const diff = commentOnly()
    expect(evaluate(input({ diff, story: withAssertions([{ id: 'a1', status: 'pass' }]) })).verdict).toBe('allow')
  })

  it('still allows an empty diff with no story at all', () => {
    expect(evaluate(input({ diff: commentOnly(), story: null })).verdict).toBe('allow')
  })
})

describe('a language with no installed adapter is ungated, not blocked', () => {
  /**
   * `.js` and `.ts` both map to the `ts` bucket, so they were treated as
   * gateable — but no adapter for them ships in this build, so no probe could
   * ever verify and every changed line reported SV011: "accepted but never
   * verified". A TypeScript repository could not pass the gate at all, and
   * the finding told the reader to go and fix a path mapping that was fine.
   *
   * Ungated and honest beats blocked and wrong. SUPPORTED_LANGUAGES says what
   * the design covers; only the caller knows what is installed.
   */
  const tsDiff = () => diffOf('src/app.ts', ['const bonus = 1', 'return bonus'])

  it('warns rather than blocking when the adapter is absent', () => {
    const diff = tsDiff()
    const r = evaluate(input({ diff, story: null, instrumentable: ['py', 'go'] }))
    expect(codes(r)).toContain('SV016')
    expect(codes(r)).not.toContain('SV011')
    expect(codes(r)).not.toContain('SV001')
    expect(r.verdict).toBe('allow')
  })

  it('names the missing adapter instead of blaming a path mapping', () => {
    const diff = tsDiff()
    const r = evaluate(input({ diff, story: null, instrumentable: ['py'] }))
    const finding = r.findings.find((f) => f.code === 'SV016')!
    expect(finding.remedy).toMatch(/doctor/)
    expect(finding.remedy).not.toMatch(/path.mapping/i)
  })

  it('still gates a language whose adapter is installed', () => {
    const diff = diffOf('src/pricing.py', ['bonus = 1', 'return bonus'])
    const r = evaluate(input({ diff, story: null, instrumentable: ['py'] }))
    expect(codes(r)).toContain('SV001')
    expect(r.verdict).toBe('block')
  })

  it('gates everything when the caller does not say what is installed', () => {
    // Absent means "assume the design's list", so existing callers are
    // unaffected rather than silently loosened.
    const r = evaluate(input({ diff: tsDiff(), story: null }))
    expect(r.verdict).toBe('block')
  })
})

describe('SV011 repeats what the adapter said, instead of guessing', () => {
  /**
   * Two agents independently hit this. Delve refuses a breakpoint on a struct
   * field or a bare `} else {` and answers "could not find statement at
   * si_test.go:137, please use a line with a statement" — but the finding said
   * "almost always a path-mapping problem", so both went hunting for a path
   * mapping that was fine. The sentence they needed was already in the
   * harness log; it just never reached the finding.
   */
  const unverified = (reason?: string) => {
    const diff = diffOf()
    const lines = coverageFor(diff).map((l, i) =>
      i === 0 ? { ...l, verified: false, class: 'unbound' as const, ...(reason ? { reason } : {}) } : l)
    return evaluate(input({ diff, story: storyFor(diff, {}, lines) }))
  }

  it('quotes the adapter when it explained itself', () => {
    const r = unverified('could not find statement at src/pricing/discount.ts:41')
    const finding = r.findings.find((f) => f.code === 'SV011')!
    expect(finding.message).toMatch(/could not find statement/)
  })

  it('sends a non-statement probe to the plan, not to doctor', () => {
    const finding = unverified('could not find statement at x:41').findings.find((f) => f.code === 'SV011')!
    expect(finding.remedy).toMatch(/executable lines|declaration/)
    expect(finding.remedy).not.toMatch(/path-mapping/)
  })

  it('still suggests doctor when the adapter said nothing', () => {
    const finding = unverified().findings.find((f) => f.code === 'SV011')!
    expect(finding.remedy).toMatch(/doctor/)
    expect(finding.message).toMatch(/never actually watched/)
  })
})

describe('scope.languages actually filters, rather than only describing', () => {
  /**
   * It was read in exactly one place — the skill generator, to print a table
   * of what this project gates. The gate never consulted it, so the table
   * described a filter that did not exist and a project could not opt a
   * language out however it configured itself.
   */
  it('leaves out a language the project excluded', () => {
    const diff = diffOf('src/app.ts', ['const bonus = 1', 'return bonus'])
    const policy = policyOf({ scope: { include: ['**'], exclude: [], languages: ['py', 'go'] } })
    const r = evaluate(input({ diff, story: null, policy }))
    expect(codes(r)).toContain('SV016')
    expect(r.verdict).toBe('allow')
  })

  it('gates a language the project kept', () => {
    const diff = diffOf('src/app.ts', ['const bonus = 1', 'return bonus'])
    const policy = policyOf({ scope: { include: ['**'], exclude: [], languages: ['ts'] } })
    expect(evaluate(input({ diff, story: null, policy })).verdict).toBe('block')
  })
})

describe('a step that failed is reported, not left in the story', () => {
  /**
   * A real run had five of fourteen steps time out. The run kept going — a
   * failed step is often the interesting one — but `--json` said nothing
   * about any of them, and `verify --json` returns only the gate's verdict.
   * The reader saw a bewildering final assertion diff and would have had to
   * know to go digging in story.diagnostics.
   */
  it('warns once per failed step, with what the step reported', () => {
    const diff = diffOf()
    const story = storyFor(diff, {
      diagnostics: [
        { code: 'SVH030', severity: 'warn', message: 'step 10 failed: locator.click: Timeout 10000ms exceeded' },
        { code: 'SVH001', severity: 'warn', message: 'something else entirely' },
      ],
    })
    const r = evaluate(input({ diff, story }))
    const failed = r.findings.filter((f) => f.code === 'SV022')
    expect(failed).toHaveLength(1)
    expect(failed[0]!.message).toMatch(/Timeout 10000ms/)
  })

  it('does not block on its own — the assertions decide that', () => {
    const diff = diffOf()
    const story = storyFor(diff, {
      diagnostics: [{ code: 'SVH030', severity: 'warn', message: 'step 3 failed: boom' }],
    })
    expect(evaluate(input({ diff, story })).verdict).toBe('allow')
  })

  it('says nothing when every step ran', () => {
    const r = evaluate(input({ diff: diffOf() }))
    expect(codes(r)).not.toContain('SV022')
  })
})

describe('an assertion that was never evaluated cannot pass as green', () => {
  /**
   * The worst shape a run can take. An agent ran `verify` without `--record`,
   * so every `terminal-match` assertion was skipped for want of a transcript
   * — and the verdict came back `allow`, `findings: []`, exit 0, with
   * `assertionsPassed: 0/2` the only sign. Indistinguishable from a real pass
   * unless you happened to read the metrics.
   *
   * SV021 warns that a plan claims nothing. This is a plan that claims
   * something and never tested it, which is worse, so it blocks.
   */
  const withSkipped = () => {
    const diff = diffOf()
    return storyFor(diff, {}, coverageFor(diff), [
      { id: 'a1', status: 'skipped', diff: 'the run produced no readable transcript to assert on' },
      { id: 'a2', status: 'pass' },
    ])
  }

  it('blocks, naming the assertion and why it could not run', () => {
    const diff = diffOf()
    const r = evaluate(input({ diff, story: withSkipped() }))
    expect(r.verdict).toBe('block')
    const finding = r.findings.find((f) => f.code === 'SV023')!
    expect(finding.message).toMatch(/a1/)
    expect(finding.message).toMatch(/no readable transcript/)
  })

  it('points at the likely cause rather than at the plan', () => {
    const finding = evaluate(input({ diff: diffOf(), story: withSkipped() })).findings.find((f) => f.code === 'SV023')!
    expect(finding.remedy).toMatch(/--record/)
  })

  it('does not fire when every assertion actually ran', () => {
    const diff = diffOf()
    const story = storyFor(diff, {}, coverageFor(diff), [{ id: 'a1', status: 'pass' }])
    expect(codes(evaluate(input({ diff, story })))).not.toContain('SV023')
  })

  it('is not confused with SV021, which is about having none at all', () => {
    const diff = diffOf()
    const r = evaluate(input({ diff, story: withSkipped() }))
    expect(codes(r)).toContain('SV023')
    expect(codes(r)).not.toContain('SV021')
  })
})
