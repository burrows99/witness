import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileRedactionPolicy, DEFAULT_CONFIG, validateRecording, type RunContext } from '@swe-verify/core'
import { ArtifactStore } from '../../src/store.js'
import { RECORDERS, createRecorder, type RecorderDeps } from '../../src/registry.js'

/**
 * L1 — the Recorder contract, run against every implementation.
 *
 * The point of a seam is that the thing behind it is replaceable. Playwright
 * writes a webm from a browser context; VHS reads a `.tape` file and shells
 * out; asciinema would write a cast. None of that may reach a consumer: the
 * runner asks the registry for recorders, starts them, marks each step and
 * stops them, and what comes back is artefacts with declared readers.
 *
 * So this suite deliberately never names a recording technology. Anything it
 * can only assert about `browser` belongs in browser-recorder.test.ts.
 */

function ctx(runDir: string): RunContext {
  return {
    runId: '01JB7QK3M9X2VYD8N4T6ZQWERT',
    repoRoot: process.cwd(),
    runDir,
    traceId: 'a'.repeat(32),
    env: {},
    log: () => {},
    monoNs: () => Number(process.hrtime.bigint()),
  }
}

/** Deps with nothing wired up: no browser context, no commands to run. */
function bareDeps(): RecorderDeps {
  const runDir = mkdtempSync(join(tmpdir(), 'swe-verify-contract-'))
  return {
    runDir,
    store: new ArtifactStore({
      runDir,
      policy: compileRedactionPolicy(DEFAULT_CONFIG.redact),
      budgetBytes: 64 * 1024 * 1024,
    }),
  }
}

describe('the registry is the only way in', () => {
  it('names every recorder this build ships', () => {
    expect([...RECORDERS]).toEqual([...RECORDERS].slice().sort())
    expect(RECORDERS.length).toBeGreaterThan(0)
  })

  it('returns nothing for a recorder whose inputs are absent, rather than throwing', () => {
    // A run with no web driver must not fail because the browser recorder
    // could not be built. It is simply not applicable to that run.
    for (const name of RECORDERS) expect(createRecorder(name, bareDeps())).toBeNull()
  })

  it('refuses a name it does not ship, rather than silently recording nothing', () => {
    expect(() => createRecorder('imaginary' as (typeof RECORDERS)[number], bareDeps())).toThrow(/imaginary/)
  })
})

describe.each(RECORDERS)('Recorder contract: %s', (name) => {
  /** Every recorder is built the same way, from whatever this one needs. */
  const build = () => {
    const deps = { ...bareDeps(), ...stubInputs() }
    const recorder = createRecorder(name, deps)
    if (!recorder) throw new Error(`stubInputs() does not satisfy ${name}`)
    return { recorder, deps }
  }

  it('reports its own name, so a story can say what recorded it', () => {
    expect(build().recorder.name).toBe(name)
  })

  it('declares what it produces, using kinds the schema knows', () => {
    const { recorder } = build()
    expect(recorder.produces.length).toBeGreaterThan(0)
    expect(validateRecording(recorder, [])).toEqual([])
  })

  it('is a session: start, mark each step, stop', async () => {
    const { recorder, deps } = build()
    await recorder.start(ctx(deps.runDir))
    await recorder.mark({ seq: 1, driver: 'web', action: 'goto' })
    await recorder.mark({ seq: 2, driver: 'web', action: 'click' })
    await expect(recorder.stop()).resolves.toBeInstanceOf(Array)
  })

  it('survives a run with no steps at all', async () => {
    // A fixture that never came up produces no steps. That is a story worth
    // sealing, not a crash inside the evidence layer.
    const { recorder, deps } = build()
    await recorder.start(ctx(deps.runDir))
    await expect(recorder.stop()).resolves.toBeInstanceOf(Array)
  })

  it('emits only what it declared, with a reader on every artefact', async () => {
    const { recorder, deps } = build()
    await recorder.start(ctx(deps.runDir))
    await recorder.mark({ seq: 1, driver: 'web', action: 'goto' })
    const produced = await recorder.stop()
    expect(validateRecording(recorder, produced)).toEqual([])
  })

  it('degrades to no artefacts rather than throwing when its tool is missing', async () => {
    // ffmpeg absent, vhs absent, a browser that never opened: the run still
    // has to reach a verdict. Losing the film is not losing the gate.
    const { recorder, deps } = build()
    await recorder.start(ctx(deps.runDir))
    await expect(recorder.stop()).resolves.toBeDefined()
  })

  it('does not require its own cleanup to be called twice', async () => {
    const { recorder, deps } = build()
    await recorder.start(ctx(deps.runDir))
    await recorder.stop()
    await expect(recorder.stop()).resolves.toBeInstanceOf(Array)
  })
})

/**
 * Inputs that satisfy every recorder without needing the real tool. Each
 * recorder declares what it needs; a contract suite that had to know which
 * is which would not be a contract suite.
 */
function stubInputs(): Partial<RecorderDeps> {
  return {
    browser: {
      videoDir: () => mkdtempSync(join(tmpdir(), 'swe-verify-vid-')),
      recordedVideo: () => null,
      finish: async () => {},
    },
    terminal: { steps: [{ command: 'true' }], cwd: process.cwd() },
  }
}
