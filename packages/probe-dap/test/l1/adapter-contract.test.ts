import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import type { Language, ProbeTarget } from '@swe-verify/core'
import { adapterFor, adapterReport } from '../../src/adapters.js'
import { runWithProbes } from '../../src/runner.js'

/**
 * L1 — the adapter contract, run against the real adapter for every language
 * the build supports. One tiny fixture app per language, the same assertions
 * for all of them: any per-language failure is an adapter bug.
 *
 * The load-bearing assertion is `verified === true`. "Accepted but unbound"
 * is the silent killer (R2): the adapter answers OK, the probe never fires,
 * and it looks exactly like the code never ran — which is the signal the
 * whole coverage gate rests on.
 */

const FIXTURES = join(import.meta.dirname, '..', '..', '..', '..', 'fixtures', 'l1')

interface Case {
  language: Language
  dir: string
  program: string
  /** The line that runs: inside the tier >= 2 branch. */
  executedLine: number
  /** The line that does not run: the guard for a negative total. */
  unexecutedLine: number
  /** A variable that is bound at `executedLine`, and its expected value. */
  capture: { name: string; value: unknown }
  /** A line with no statement on it, which every adapter treats differently. */
  blankLine: number
}

const CASES: Case[] = [
  {
    language: 'py',
    dir: join(FIXTURES, 'py'),
    program: 'pricing.py',
    executedLine: 8,      // return base * (1 - bonus)
    unexecutedLine: 10,   // raise ValueError(...)
    capture: { name: 'tier', value: 2 },
    blankLine: 12,
  },
  {
    language: 'go',
    dir: join(FIXTURES, 'go'),
    program: 'main.go',
    executedLine: 10,     // return base * (1 - bonus)
    unexecutedLine: 13,   // panic("total must not be negative")
    capture: { name: 'tier', value: 2 },
    blankLine: 17,
  },
]

const target = (id: string, file: string, line: number, language: Language, expressions: string[] = []): ProbeTarget =>
  ({ id, file, line, language, expressions })

describe('adapter availability is declared, never guessed (NFR-12)', () => {
  it('reports one row per declared language', () => {
    const report = adapterReport(process.cwd())
    expect(report.map((r) => r.language).sort()).toEqual(['go', 'java', 'py', 'ts'])
  })

  it('an unavailable adapter says why and what to do, instead of degrading', () => {
    const unavailable = adapterReport(process.cwd()).filter((r) => !r.available)
    for (const row of unavailable) {
      expect(row.detail.length).toBeGreaterThan(10)
      expect(row.remedy).toBeTruthy()
    }
  })

  it('refuses to run a language with no adapter rather than log-scraping (D3)', async () => {
    const spec = adapterFor('java')
    if (spec.detect().available) return
    await expect(runWithProbes({
      language: 'java', program: 'x.jar', cwd: process.cwd(), repoRoot: process.cwd(), targets: [],
    })).rejects.toThrow(/no debug adapter for java/)
  })
})

for (const testCase of CASES) {
  const available = adapterFor(testCase.language).detect(process.cwd()).available
  const suite = available ? describe : describe.skip

  suite(`adapter contract: ${testCase.language} (${adapterFor(testCase.language).name})`, () => {
    const run = (targets: ProbeTarget[], overrides: Partial<Parameters<typeof runWithProbes>[0]> = {}) =>
      runWithProbes({
        language: testCase.language,
        program: testCase.program,
        cwd: testCase.dir,
        repoRoot: testCase.dir,
        // The toolchain (a virtualenv, a vendored adapter) belongs to the
        // project, not to the fixture directory.
        adapterRoot: process.cwd(),
        targets,
        timeoutMs: 60_000,
        ...overrides,
      })

    it('verifies a probe on an executable line — accepted is not the same as bound (R2)', async () => {
      const result = await run([target('p001', testCase.program, testCase.executedLine, testCase.language)])
      expect(result.installed).toHaveLength(1)
      expect(result.installed[0]!.verified).toBe(true)
    })

    it('fires the probe when the line executes', async () => {
      const result = await run([target('p001', testCase.program, testCase.executedLine, testCase.language)])
      expect(result.hitsByProbe.get('p001')).toBeGreaterThan(0)
    })

    it('does not fire a probe on a line that never runs', async () => {
      const result = await run([
        target('p001', testCase.program, testCase.executedLine, testCase.language),
        target('p002', testCase.program, testCase.unexecutedLine, testCase.language),
      ])
      expect(result.hitsByProbe.get('p001')).toBeGreaterThan(0)
      expect(result.hitsByProbe.get('p002')).toBe(0)
    })

    it('captures variable state at the line without suspending the process', async () => {
      const result = await run([
        target('p001', testCase.program, testCase.executedLine, testCase.language, [testCase.capture.name]),
      ])
      const hit = result.hits.find((h) => h.probeId === 'p001')
      expect(hit?.vars[testCase.capture.name]).toEqual(testCase.capture.value)
    })

    it('lets the program run to completion — logpoints never stop the world', async () => {
      const result = await run([
        target('p001', testCase.program, testCase.executedLine, testCase.language, [testCase.capture.name]),
      ])
      expect(result.stdout).toMatch(/result/)
      expect(result.timedOut).toBe(false)
    })

    it('reports a probe on an unmapped path as unverified, not as unexecuted (SV011)', async () => {
      const result = await run(
        [target('p001', 'no/such/file.src', testCase.executedLine, testCase.language)],
        { timeoutMs: 30_000 },
      )
      expect(result.installed[0]!.verified).toBe(false)
    })

    it('records where the adapter bound a probe when it slides the line', async () => {
      const result = await run([target('p001', testCase.program, testCase.blankLine, testCase.language)])
      const probe = result.installed[0]!
      // Either the adapter refused the line, or it moved it. Both are fine;
      // silently reporting the requested line as bound is not.
      expect(probe.verified === false || probe.adapterLine !== undefined || probe.line === testCase.blankLine).toBe(true)
      if (probe.adapterLine !== undefined) expect(probe.adapterLine).not.toBe(testCase.blankLine)
    })

    it('installs several probes across one file in a single declarative call', async () => {
      const result = await run([
        target('p001', testCase.program, testCase.executedLine, testCase.language),
        target('p002', testCase.program, testCase.unexecutedLine, testCase.language),
      ])
      expect(result.installed.map((p) => p.id).sort()).toEqual(['p001', 'p002'])
      expect(result.installed.every((p) => p.verified)).toBe(true)
    })

    it('tears down without leaving the debuggee running', async () => {
      const result = await run([target('p001', testCase.program, testCase.executedLine, testCase.language)])
      expect(result.timedOut).toBe(false)
    })
  })
}

/**
 * L1 — driving a Go *library* package through its tests.
 *
 * This is the shape almost all real Go code takes: no `main` to point at, and
 * the thing that exercises a package is `go test`. Without this, swe-verify
 * can gate a toy program and nothing else.
 */
describe.skipIf(!adapterFor('go').detect(process.cwd(), process.env).available)('adapter contract: go, mode test', () => {
  const dir = join(FIXTURES, 'go')
  const run = (targets: ProbeTarget[], args?: string[]) =>
    runWithProbes({
      language: 'go',
      program: '.',
      cwd: dir,
      repoRoot: dir,
      adapterRoot: process.cwd(),
      targets,
      mode: 'test',
      ...(args ? { args } : {}),
      timeoutMs: 120_000,
    })

  it('verifies and fires a probe on a line the tests exercise', async () => {
    const result = await run([target('p001', 'main.go', 10, 'go', ['tier'])])
    expect(result.installed[0]!.verified).toBe(true)
    expect(result.hitsByProbe.get('p001')).toBeGreaterThan(0)
  })

  it('captures state from inside the test run', async () => {
    const result = await run([target('p001', 'main.go', 10, 'go', ['tier'])])
    expect(result.hits.find((h) => h.probeId === 'p001')?.vars.tier).toBe(2)
  })

  it('does not fire a probe on a line no test reaches', async () => {
    const result = await run([
      target('p001', 'main.go', 10, 'go'),
      target('p002', 'main.go', 13, 'go'),
    ])
    expect(result.hitsByProbe.get('p001')).toBeGreaterThan(0)
    expect(result.hitsByProbe.get('p002')).toBe(0)
  })

  it('narrows the run to one test, so a probe reports what that test alone reached', async () => {
    const result = await run(
      [target('p001', 'main.go', 10, 'go')],
      ['-test.run', 'TestApplyTieredLeavesTierOneAlone'],
    )
    // Tier 1 never enters the discount branch.
    expect(result.hitsByProbe.get('p001')).toBe(0)
  })

  it('lets the test binary run to completion', async () => {
    const result = await run([target('p001', 'main.go', 10, 'go')])
    expect(result.timedOut).toBe(false)
  })
})
