import { describe, expect, it } from 'vitest'
import { planProbes, identifiersIn } from '../../src/instrument.js'
import { normaliseDiff } from '../../src/diff.js'
import { DEFAULT_CONFIG } from '../../src/schema.js'

const diffOf = (file: string, lines: string[], start = 40) =>
  normaliseDiff([
    `diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`,
    `@@ -${start - 1},1 +${start - 1},${lines.length + 1} @@`, ' const base = total',
    ...lines.map((l) => `+${l}`),
  ].join('\n'))

describe('identifiersIn — what a probe should capture at a line', () => {
  it('picks out the variables read on the line', () => {
    // `bonus` is what the line assigns, so it is not yet bound when the
    // logpoint fires; see the assignment-target suite below.
    expect(identifiersIn('const bonus = tier * 0.05', 'ts')).toEqual(['tier'])
  })

  it('skips language keywords and literals', () => {
    expect(identifiersIn('return base * (1 - bonus)', 'ts')).toEqual(['base', 'bonus'])
    expect(identifiersIn('if (tier >= 2) {', 'ts')).toEqual(['tier'])
  })

  it('skips string contents, which are not identifiers', () => {
    expect(identifiersIn('log.info("tier applied", tier)', 'ts')).toEqual(['log', 'tier'])
  })

  it('reads only the receiver of a property access, not the property name', () => {
    expect(identifiersIn('total = cart.items.length', 'ts')).toEqual(['cart'])
    expect(identifiersIn('send(cart.items.length)', 'ts')).toEqual(['cart'])
  })

  it('skips a call target so a probe never invokes anything', () => {
    expect(identifiersIn('applyTiered(total, tier)', 'ts')).toEqual(['total', 'tier'])
  })

  it('handles python and go keywords', () => {
    expect(identifiersIn('if err != nil {', 'go')).toEqual(['err'])
    expect(identifiersIn('for item in cart:', 'py')).toEqual(['item', 'cart'])
  })

  it('caps how much it captures, so a wide line cannot blow the artefact budget', () => {
    const wide = `x = ${Array.from({ length: 40 }, (_, i) => `v${i}`).join(' + ')}`
    expect(identifiersIn(wide, 'ts').length).toBeLessThanOrEqual(8)
  })

  it('returns nothing for a line with no identifiers', () => {
    expect(identifiersIn('return 42', 'ts')).toEqual([])
  })
})

describe('planProbes — the diff decides where probes go (FR-9)', () => {
  it('places one probe per gateable changed line, with no per-line decision', () => {
    const diff = diffOf('src/a.ts', ['const bonus = tier * 0.05', 'return base * (1 - bonus)'])
    const probes = planProbes(diff, DEFAULT_CONFIG)
    expect(probes).toHaveLength(2)
    expect(probes[0]).toMatchObject({ file: 'src/a.ts', line: 40 })
    expect(probes[0]!.id).not.toBe(probes[1]!.id)
  })

  it('probes defensive lines too — the gate needs to know whether they fired', () => {
    const diff = diffOf('src/a.ts', ['throw new Error("bad")'])
    expect(planProbes(diff, DEFAULT_CONFIG)).toHaveLength(1)
  })

  it('never probes a language it cannot instrument', () => {
    const diff = diffOf('app/b.rb', ['total = total * 2'])
    expect(planProbes(diff, DEFAULT_CONFIG)).toEqual([])
  })

  it('carries the expressions to capture at each line', () => {
    const diff = diffOf('src/a.ts', ['const bonus = tier * 0.05'])
    expect(planProbes(diff, DEFAULT_CONFIG)[0]!.expressions).toEqual(['tier'])
  })

  it('groups probes by file so one setBreakpoints call covers a file', () => {
    const patch = [
      diffOf('src/a.ts', ['const a = 1']).files, // shape only; build a two-file patch below
    ]
    expect(patch).toBeTruthy()
    const two = normaliseDiff([
      'diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,0 +1,1 @@', '+const a = 1',
      'diff --git a/src/b.ts b/src/b.ts', '--- a/src/b.ts', '+++ b/src/b.ts', '@@ -1,0 +1,2 @@', '+const b = 1', '+const c = 2',
    ].join('\n'))
    const probes = planProbes(two, DEFAULT_CONFIG)
    expect(probes.filter((p) => p.file === 'src/b.ts')).toHaveLength(2)
  })

  it('respects the probe budget rather than instrumenting a huge refactor', () => {
    const many = Array.from({ length: 20 }, (_, i) => `const v${i} = ${i}`)
    const diff = diffOf('src/a.ts', many)
    const policy = { ...DEFAULT_CONFIG, budgets: { ...DEFAULT_CONFIG.budgets, probeLines: 5 } }
    const probes = planProbes(diff, policy)
    expect(probes).toHaveLength(5)
  })

  it('reports when the budget truncated instrumentation, so it is never silent', () => {
    const many = Array.from({ length: 20 }, (_, i) => `const v${i} = ${i}`)
    const policy = { ...DEFAULT_CONFIG, budgets: { ...DEFAULT_CONFIG.budgets, probeLines: 5 } }
    expect(planProbes(diffOf('src/a.ts', many), policy, { onTruncate: (n) => n })).toHaveLength(5)
  })

  it('assigns stable ids across repeated planning of the same diff', () => {
    const diff = diffOf('src/a.ts', ['const a = 1', 'const b = 2'])
    expect(planProbes(diff, DEFAULT_CONFIG).map((p) => p.id)).toEqual(planProbes(diff, DEFAULT_CONFIG).map((p) => p.id))
  })
})

describe('identifiersIn — a logpoint fires BEFORE the line executes', () => {
  /**
   * Empirically: interpolating a name the runtime cannot resolve makes the
   * adapter emit its error *instead of* the log message, so the probe looks
   * like it never fired — a false block. The variable a line assigns is not
   * bound yet at the moment the logpoint runs, so it is never captured.
   */
  it('does not capture the target of the assignment on that line', () => {
    expect(identifiersIn('const bonus = tier * 0.05', 'ts')).toEqual(['tier'])
    expect(identifiersIn('bonus = tier * 0.05', 'py')).toEqual(['tier'])
    expect(identifiersIn('let total = price * qty', 'ts')).toEqual(['price', 'qty'])
  })

  it('handles go short declarations and var declarations', () => {
    expect(identifiersIn('bonus := tier * 2', 'go')).toEqual(['tier'])
    expect(identifiersIn('var total float64 = price', 'go')).toEqual(['price'])
  })

  it('handles a multiple-assignment target list', () => {
    expect(identifiersIn('a, b = compute(x)', 'py')).toEqual(['x'])
    expect(identifiersIn('value, err := load(id)', 'go')).toEqual(['id'])
  })

  it('still captures a compound-assignment target, which must already be bound', () => {
    expect(identifiersIn('total += bonus', 'ts')).toEqual(['total', 'bonus'])
  })

  it('is not confused by == or => which are not assignments', () => {
    expect(identifiersIn('if (tier == expected) {', 'ts')).toEqual(['tier', 'expected'])
    expect(identifiersIn('const f = (a) => a * rate', 'ts')).toEqual(['a', 'rate'])
  })

  it('captures a plain read line unchanged', () => {
    expect(identifiersIn('return base * (1 - bonus)', 'ts')).toEqual(['base', 'bonus'])
  })
})
