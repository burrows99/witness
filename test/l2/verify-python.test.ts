import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { verifySeal, type GateResult, type Story } from '@swe-verify/core'
import { adapterFor } from '@swe-verify/probe-dap'
import { TestRepo, cli, planFor } from '../helpers/repo.js'

/**
 * The fixture repo is a throwaway directory with no toolchain of its own, so
 * the interpreter is pointed at explicitly — the same override a project
 * whose venv lives somewhere unusual would use.
 */
const PY_ENV = { SWE_VERIFY_PYTHON: join(process.cwd(), '.venv', 'bin', 'python') }

/**
 * L2 — `verify` end to end against a real Python application, with real
 * debugpy logpoints. This is the M1 release criterion: a backend-only change
 * is gated on line coverage, with no browser involved.
 */

const adapterAvailable = adapterFor('py').detect(process.cwd()).available
const suite = adapterAvailable ? describe : describe.skip

const BASE_APP = `def apply_tiered(total, tier):
    base = total
    return base


def main():
    print("result", apply_tiered(100, 2))


if __name__ == "__main__":
    main()
`

/** A change whose lines all execute for the input the plan drives. */
const EXERCISED_CHANGE = `def apply_tiered(total, tier):
    base = total
    if tier >= 2:
        bonus = tier * 0.05
        return base * (1 - bonus)
    return base


def main():
    print("result", apply_tiered(100, 2))


if __name__ == "__main__":
    main()
`

/** The same change, but the driven input never reaches the new branch. */
const UNEXERCISED_CHANGE = `def apply_tiered(total, tier):
    base = total
    if tier >= 9:
        bonus = tier * 0.05
        return base * (1 - bonus)
    return base


def main():
    print("result", apply_tiered(100, 2))


if __name__ == "__main__":
    main()
`

let repo: TestRepo
let base: string

beforeEach(() => {
  repo = new TestRepo()
  repo.write('app/pricing.py', BASE_APP)
  repo.write('.swe-verify/config.json', JSON.stringify({ schema: 'swe-verify/config@1', vcs: 'local' }))
  repo.writePlan(planFor('pricing', ['app/**'], {
    fixture: { kind: 'process', language: 'py', program: 'app/pricing.py', awaitExit: true },
    steps: [],
    assertions: [],
  }))
  base = repo.commit('base')
})
afterEach(() => repo.dispose())

const storyOf = (): Story => {
  const runs = join(repo.dir, '.swe-verify', 'runs')
  const id = readdirSync(runs).sort().at(-1)!
  return JSON.parse(readFileSync(join(runs, id, 'story.json'), 'utf8')) as Story
}

suite('verify — a backend-only change, gated on real line coverage (M1)', () => {
  it('passes when every changed line actually executed', async () => {
    repo.write('app/pricing.py', EXERCISED_CHANGE)
    const result = await cli(repo, ['verify', '--plan', 'pricing', '--base', base, '--json'], { env: PY_ENV })
    expect(result.json<GateResult>().findings.filter((f) => f.severity === 'error')).toEqual([])
    expect(result.code).toBe(0)
  })

  it('blocks with SV010 on the line the run never reached', async () => {
    repo.write('app/pricing.py', UNEXERCISED_CHANGE)
    const result = await cli(repo, ['verify', '--plan', 'pricing', '--base', base, '--json'], { env: PY_ENV })
    expect(result.code).toBe(2)
    const findings = result.json<GateResult>().findings.filter((f) => f.code === 'SV010')
    expect(findings.length).toBeGreaterThan(0)
    // Lines 4 and 5 are the body of the branch that was never taken.
    expect(findings.map((f) => f.locus!.line)).toEqual(expect.arrayContaining([4, 5]))
  })

  it('verifies every probe it installed — accepted is not bound (R2)', async () => {
    repo.write('app/pricing.py', EXERCISED_CHANGE)
    await cli(repo, ['verify', '--plan', 'pricing', '--base', base, '--json'], { env: PY_ENV })
    const story = storyOf()
    const probed = story.coverage.lines.filter((l) => l.probe_id)
    expect(probed.length).toBeGreaterThan(0)
    expect(probed.every((l) => l.verified === true)).toBe(true)
  })

  it('captures variable state at the changed line, in the story', async () => {
    repo.write('app/pricing.py', EXERCISED_CHANGE)
    await cli(repo, ['verify', '--plan', 'pricing', '--base', base, '--json'], { env: PY_ENV })
    const logpoints = storyOf().events.filter((e) => e.type === 'logpoint')
    expect(logpoints.length).toBeGreaterThan(0)
    const captured = logpoints.flatMap((e) => Object.entries((e as { vars: Record<string, unknown> }).vars))
    expect(captured).toContainEqual(['tier', 2])
  })

  it('lets the application run to completion — logpoints never suspend it', async () => {
    repo.write('app/pricing.py', EXERCISED_CHANGE)
    await cli(repo, ['verify', '--plan', 'pricing', '--base', base, '--json'], { env: PY_ENV })
    const log = readFileSync(join(repo.dir, '.swe-verify', 'runs', storyOf().run_id, 'logs', 'harness.log'), 'utf8')
    expect(log).toMatch(/result 90/)
  })

  it('seals the story so a third party can recompute the verdict', async () => {
    repo.write('app/pricing.py', EXERCISED_CHANGE)
    await cli(repo, ['verify', '--plan', 'pricing', '--base', base, '--json'], { env: PY_ENV })
    const story = storyOf()
    expect(story.seal).toBeDefined()
    expect(verifySeal(story)).toBe(true)
  })

  it('binds the story to the diff it verified', async () => {
    repo.write('app/pricing.py', EXERCISED_CHANGE)
    await cli(repo, ['verify', '--plan', 'pricing', '--base', base, '--json'], { env: PY_ENV })
    expect(storyOf().diff.hash).toBe(repo.diffHash(base))
  })

  it('writes a harness log that says what the probes did (M5)', async () => {
    repo.write('app/pricing.py', EXERCISED_CHANGE)
    await cli(repo, ['verify', '--plan', 'pricing', '--base', base, '--json'], { env: PY_ENV })
    const log = readFileSync(join(repo.dir, '.swe-verify', 'runs', storyOf().run_id, 'logs', 'harness.log'), 'utf8')
    expect(log).toMatch(/probes: \d+ installed, \d+ verified/)
    expect(log).toMatch(/sealed story/)
  })

  it('goes stale the moment the code changes again (FR-2)', async () => {
    repo.write('app/pricing.py', EXERCISED_CHANGE)
    await cli(repo, ['verify', '--plan', 'pricing', '--base', base, '--json'], { env: PY_ENV })
    repo.write('app/pricing.py', EXERCISED_CHANGE.replace('0.05', '0.07'))
    const result = await cli(repo, ['gate', '--base', base, '--json'], { env: PY_ENV })
    expect(result.code).toBe(2)
    expect(result.json<GateResult>().findings.map((f) => f.code)).toEqual(['SV003'])
  })

  it('reports a run as JSON the agent can read without parsing prose (US-2 AC3)', async () => {
    repo.write('app/pricing.py', EXERCISED_CHANGE)
    const result = await cli(repo, ['run', '--plan', 'pricing', '--base', base, '--json'], { env: PY_ENV })
    const payload = result.json<{ command: string; run_id: string; summary: { fired: number } }>()
    expect(payload.command).toBe('run')
    expect(payload.run_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(payload.summary.fired).toBeGreaterThan(0)
  })
})

describe('verify — refusing rather than degrading (NFR-12)', () => {
  it('starts an app whose language has no adapter, and says it is unwatched', async () => {
    // Not having an adapter means this language cannot be *gated*. It does
    // not mean the app cannot be *run*, and refusing to start it conflated
    // the two: a Node app could not have its lifecycle managed by the harness
    // at all, so two agents independently started the server by hand and
    // pointed a `kind: "none"` fixture at it — a worse plan describing the
    // same run, with the coverage outcome identical.
    repo.write('app/thing.ts', 'export const bonus = 1\nexport const total = bonus\n')
    repo.writePlan(planFor('ts-thing', ['app/**'], {
      fixture: { kind: 'process', language: 'ts', program: 'app/thing.ts', awaitExit: true },
      steps: [],
      assertions: [],
    }))
    repo.commit('add a plan for a language with no adapter')
    const result = await cli(repo, ['run', '--plan', 'ts-thing', '--base', base], { env: PY_ENV })
    expect(result.code).toBe(0)
    // The story says so, so the reason survives past the terminal scrollback.
    const diagnostics = storyOf().diagnostics.map((d) => `${d.code} ${d.message}`).join('\n')
    expect(diagnostics).toMatch(/SVH001/)
    expect(diagnostics).toMatch(/could not be instrumented|no debuggable fixture/)
  })

  it('never claims coverage for a run with no debugger attached', async () => {
    // The property that must survive: degrading the *fixture* must not
    // degrade the *gate*. The changed lines are reported ungated, not fired.
    repo.write('app/thing.ts', 'export const bonus = 1\nexport const total = bonus\n')
    repo.writePlan(planFor('ts-thing', ['app/**'], {
      fixture: { kind: 'process', language: 'ts', program: 'app/thing.ts', awaitExit: true },
      steps: [],
      assertions: [],
    }))
    repo.commit('add a plan for a language with no adapter')
    const result = await cli(repo, ['verify', '--plan', 'ts-thing', '--base', base, '--json'], { env: PY_ENV })
    const gate = result.json<GateResult>()
    expect(gate.findings.map((f) => f.code)).toContain('SV016')
    expect(gate.metrics.fired).toBe(0)
  })

  it('works the same run from a subdirectory as from the repo root', async () => {
    // `git diff` reports paths relative to the repository root wherever it is
    // invoked. Using --cwd as the path base doubled the prefix — a probe on
    // `app/pricing.py` went to the adapter as `app/app/pricing.py`, which it
    // rejected as a file that does not exist, surfacing as SV011 "almost
    // always a path-mapping problem" with no hint that --cwd caused it. Scope
    // globs matched the root-relative path while fixture paths resolved from
    // --cwd, so one plan had two ideas of where it was.
    repo.write('app/pricing.py', EXERCISED_CHANGE)
    const fromRoot = await cli(repo, ['verify', '--plan', 'pricing', '--base', base, '--json'], { env: PY_ENV })
    const fromSubdir = await cli(repo, ['verify', '--plan', 'pricing', '--base', base, '--json', '--cwd', join(repo.dir, 'app')], { env: PY_ENV })

    expect(fromSubdir.code).toBe(fromRoot.code)
    expect(fromSubdir.json<{ verdict: string }>().verdict).toBe(fromRoot.json<{ verdict: string }>().verdict)
    expect(fromSubdir.json<{ findings: Array<{ code: string }> }>().findings.map((f) => f.code))
      .toEqual(fromRoot.json<{ findings: Array<{ code: string }> }>().findings.map((f) => f.code))
  })

  it('names the doubled path when program repeats the directory from file', async () => {
    // `file` sets the working directory and `program` resolves inside it, so
    // naming the same repo-relative path in both doubles the prefix. Two
    // agents lost a run each to this: the debuggee died with "Cannot find
    // module", which surfaced as "fixture never became ready" — a harness
    // failure whose real cause was only in the log.
    repo.write('svc/server.py', 'print("up")\n')
    repo.writePlan(planFor('doubled', ['svc/**'], {
      fixture: { kind: 'process', language: 'py', file: 'svc/server.py', program: 'svc/server.py', awaitExit: true },
      steps: [],
      assertions: [],
    }))
    repo.commit('add a plan whose program repeats the directory')
    const result = await cli(repo, ['run', '--plan', 'doubled', '--base', base], { env: PY_ENV })
    expect(result.code).toBe(3)
    expect(result.stderr).toMatch(/svc\/svc\/server\.py|does not exist/)
    expect(result.stderr).toMatch(/relative to that|basename/)
  })

  it('names the missing compose file rather than failing later at spawn', async () => {
    repo.writePlan(planFor('composed', ['app/**'], {
      fixture: { kind: 'compose' },
      steps: [],
      assertions: [],
    }))
    repo.commit('add a compose plan with no file')
    const result = await cli(repo, ['run', '--plan', 'composed', '--base', base], { env: PY_ENV })
    expect(result.code).toBe(3)
    expect(result.stderr).toMatch(/needs "file"/)
  })

  it('reports a missing Docker as a harness failure, not the change\'s fault', async () => {
    // Exit 4, not 2 or 3: nothing about the diff can fix a machine with no
    // Docker on it, and blaming the change would send someone editing code
    // that is fine.
    repo.writePlan(planFor('composed2', ['app/**'], {
      fixture: { kind: 'compose', file: 'docker-compose.yml' },
      steps: [],
      assertions: [],
    }))
    repo.commit('add a compose plan')
    const result = await cli(repo, ['run', '--plan', 'composed2', '--base', base], {
      // An empty PATH is the portable way to make both compose forms absent.
      env: { ...PY_ENV, PATH: '/nonexistent' },
    })
    expect(result.code).toBe(4)
    expect(result.stderr).toMatch(/docker.compose|Docker Compose/i)
  })
})

suite('show — the viewer (FR-16, M3)', () => {
  it('renders one self-contained page next to the artefacts it links', async () => {
    repo.write('app/pricing.py', EXERCISED_CHANGE)
    await cli(repo, ['verify', '--plan', 'pricing', '--base', base, '--json'], { env: PY_ENV })
    const result = await cli(repo, ['show', '--base', base, '--json'], { env: PY_ENV })
    expect(result.code).toBe(0)

    const viewerPath = join(repo.dir, result.json<{ viewer: string }>().viewer)
    const html = readFileSync(viewerPath, 'utf8')
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).not.toMatch(/src="https?:/)
    expect(viewerPath).toContain(storyOf().run_id)
  })

  it('shows the verdict the current diff produces, not the one the run recorded', async () => {
    repo.write('app/pricing.py', EXERCISED_CHANGE)
    await cli(repo, ['verify', '--plan', 'pricing', '--base', base, '--json'], { env: PY_ENV })
    repo.write('app/pricing.py', EXERCISED_CHANGE.replace('0.05', '0.07'))
    const result = await cli(repo, ['show', '--base', base, '--json'], { env: PY_ENV })
    expect(result.json<{ verdict: string }>().verdict).toBe('block')
    expect(readFileSync(join(repo.dir, result.json<{ viewer: string }>().viewer), 'utf8')).toMatch(/SV003/)
  })

  it('says so, rather than crashing, when there is no run to show', async () => {
    const result = await cli(repo, ['show'], { env: PY_ENV })
    expect(result.code).toBe(3)
    expect(result.stderr).toMatch(/no run to show/)
  })
})
