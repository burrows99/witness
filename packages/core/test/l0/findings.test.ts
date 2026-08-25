import { describe, expect, it } from 'vitest'
import { FINDING_CATALOG, findingSummary } from '../../src/findings.js'
import { evaluate } from '../../src/gate.js'
import { NOW, coverageFor, diffOf, planRef, policyOf, storyFor } from '../helpers/build.js'

/**
 * Finding codes are the contract with every consumer: the viewer's gate
 * explainer, the CI annotation, the agent's next decision, the generated
 * skill and the L3 harness all key off them. One catalogue means a code
 * cannot mean one thing in the gate and another in the documentation.
 */

describe('FINDING_CATALOG', () => {
  it('describes every code the gate can emit', () => {
    // Codes are discovered from the gate itself rather than re-listed here,
    // so adding one to the union without documenting it fails this test.
    const emitted = new Set<string>()
    const diff = diffOf()
    for (const story of [null, storyFor(diff, {}, coverageFor(diff).map((l) => ({ ...l, hits: 0 })))]) {
      const result = evaluate({ story, diff, plans: [planRef()], policy: policyOf(), bypass: null, now: NOW })
      for (const finding of result.findings) emitted.add(finding.code)
    }
    for (const code of emitted) expect(FINDING_CATALOG[code as keyof typeof FINDING_CATALOG], code).toBeDefined()
  })

  it('gives each code a one-line meaning and a severity', () => {
    for (const [code, entry] of Object.entries(FINDING_CATALOG)) {
      expect(entry.summary.length, code).toBeGreaterThan(10)
      expect(['error', 'warn', 'policy'], code).toContain(entry.severity)
    }
  })

  it('covers the whole documented range, in order', () => {
    const codes = Object.keys(FINDING_CATALOG)
    expect(codes).toEqual([...codes].sort())
    expect(codes[0]).toBe('SV001')
    expect(codes).toContain('SV090')
  })

  it('renders a compact summary line for a code', () => {
    expect(findingSummary('SV010')).toMatch(/never executed/i)
    expect(findingSummary('SV999' as never)).toBe('')
  })
})
