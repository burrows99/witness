import { describe, expect, it } from 'vitest'
import { EXIT, exitCodeFor, HarnessError, UsageError } from '../../src/errors.js'
import type { GateResult } from '@witness/core'

const result = (verdict: GateResult['verdict']): GateResult => ({
  verdict,
  findings: [],
  metrics: { executable: 0, fired: 0, unverified: 0, waived: 0, defensive: 0, assertionsPassed: 0, assertionsTotal: 0 },
})

describe('exit codes (FR-8, contracts §6)', () => {
  it('maps allow to 0, block to 2, bypass to 5', () => {
    expect(exitCodeFor(result('allow'))).toBe(EXIT.ALLOW)
    expect(exitCodeFor(result('block'))).toBe(EXIT.BLOCK)
    expect(exitCodeFor(result('bypass'))).toBe(EXIT.BYPASS)
  })

  it('keeps harness failure distinct from a block — our bug is not the developer\'s', () => {
    expect(EXIT.HARNESS).toBe(4)
    expect(EXIT.HARNESS).not.toBe(EXIT.BLOCK)
    expect(new HarnessError('adapter crashed').exitCode).toBe(4)
  })

  it('keeps usage and config errors on 3', () => {
    expect(new UsageError('no such flag').exitCode).toBe(3)
    expect(EXIT.USAGE).toBe(3)
  })

  it('never reuses 1 — a bare throw must not look like a verdict', () => {
    expect(Object.values(EXIT)).not.toContain(1)
  })

  it('a harness error carries a remedy for doctor', () => {
    expect(new HarnessError('adapter crashed', 'Run witness doctor.').remedy).toMatch(/doctor/)
  })
})
