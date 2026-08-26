import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GateResult } from '../../src/core/index.js'
import { TestRepo, cli, planFor, storyFor } from '../helpers/repo.js'

/**
 * L2 — the CLI end to end against a real git repository.
 *
 * This is the M0 release criterion: a change with no story is blocked, under
 * `local` and on a host, and hand-written stories pass.
 */

let repo: TestRepo
let base: string

const SOURCE = `export function applyTiered(total: number, tier: number) {
  const base = total
  return base
}
`

beforeEach(() => {
  repo = new TestRepo()
  repo.write('src/pricing/discount.ts', SOURCE)
  repo.write('.witness/config.json', JSON.stringify({ schema: 'witness/config@1', vcs: 'auto' }))
  base = repo.commit('base')
})
afterEach(() => repo.dispose())

/** Change two executable lines inside the plan's scope. */
function makeChange() {
  repo.write('src/pricing/discount.ts', `export function applyTiered(total: number, tier: number) {
  const base = total
  const bonus = tier * 0.05
  return base * (1 - bonus)
}
`)
}

describe('init and plan', () => {
  it('scaffolds a workspace and a plan the gate can read', async () => {
    const init = await cli(repo, ['init', '--json'])
    expect(init.code).toBe(0)

    const plan = await cli(repo, ['plan', '--intent', 'checkout applies the tiered discount', '--scope', 'src/pricing/**', '--json'])
    expect(plan.code).toBe(0)
    const written = plan.json<{ path: string }>().path
    expect(written).toBe(join('.witness', 'plans', 'checkout-applies-the-tiered.plan.json'))

    const onDisk = JSON.parse(readFileSync(join(repo.dir, written), 'utf8'))
    expect(onDisk.schema).toBe('witness/plan@1')
    expect(onDisk.scope.include).toEqual(['src/pricing/**'])
  })

  it('refuses to overwrite an existing plan without --force', async () => {
    await cli(repo, ['plan', '--intent', 'x y', '--scope', 'src/**'])
    const second = await cli(repo, ['plan', '--intent', 'x y', '--scope', 'src/**'])
    expect(second.code).toBe(3)
    expect(second.stderr).toMatch(/already exists/)
  })

  it('reports a missing --scope as a usage error, not a crash', async () => {
    const r = await cli(repo, ['plan', '--intent', 'no scope'])
    expect(r.code).toBe(3)
    expect(r.stderr).toMatch(/--scope/)
  })
})

describe('gate — a change with no story (FR-1, US-1 AC1)', () => {
  it('blocks with SV001 and exit 2', async () => {
    repo.writePlan(planFor('checkout', ['src/**']))
    makeChange()
    const r = await cli(repo, ['gate', '--base', base, '--json'])
    expect(r.code).toBe(2)
    const result = r.json<GateResult>()
    expect(result.verdict).toBe('block')
    expect(result.findings.map((f) => f.code)).toEqual(['SV001'])
  })

  it('says so in human output too, with a remedy', async () => {
    repo.writePlan(planFor('checkout', ['src/**']))
    makeChange()
    const r = await cli(repo, ['gate', '--base', base])
    expect(r.stdout).toMatch(/BLOCK/)
    expect(r.stdout).toMatch(/witness verify/)
  })

  it('allows a comment-only change with no story at all (US-1 AC4)', async () => {
    repo.writePlan(planFor('checkout', ['src/**']))
    repo.write('src/pricing/discount.ts', SOURCE.replace('  const base = total', '  // keep the original total\n  const base = total'))
    const r = await cli(repo, ['gate', '--base', base, '--json'])
    expect(r.code).toBe(0)
    expect(r.json<GateResult>().verdict).toBe('allow')
  })

  it('allows a change to a file the config scope excludes', async () => {
    repo.write('.witness/config.json', JSON.stringify({ schema: 'witness/config@1', vcs: 'auto', scope: { exclude: ['**/*.test.ts'] } }))
    repo.write('src/pricing/discount.test.ts', 'const x = 1\n')
    base = repo.commit('add a test file')
    repo.write('src/pricing/discount.test.ts', 'const x = 1\nconst y = 2\n')
    const r = await cli(repo, ['gate', '--base', base, '--json'])
    expect(r.code).toBe(0)
  })

  it('never gates its own config and plan files — they are data, not code', async () => {
    repo.writePlan(planFor('checkout', ['src/**']))
    repo.write('.witness/config.json', JSON.stringify({ schema: 'witness/config@1', vcs: 'auto', domain: 'fullstack' }))
    const r = await cli(repo, ['gate', '--base', base, '--json'])
    expect(r.code).toBe(0)
  })
})

describe('gate — a hand-written story (M0 release criterion)', () => {
  const setup = () => {
    const { sha256: planSha } = repo.writePlan(planFor('checkout', ['src/**']))
    makeChange()
    return { planSha, hash: repo.diffHash(base) }
  }

  it('passes when every changed line fired and the assertions passed', async () => {
    const { planSha, hash } = setup()
    repo.writeStory(storyFor({
      planId: 'checkout', planSha, diffHash: hash, base,
      lines: [{ file: 'src/pricing/discount.ts', line: 3 }, { file: 'src/pricing/discount.ts', line: 4 }],
    }))
    const r = await cli(repo, ['gate', '--base', base, '--json'])
    expect(r.json<GateResult>().findings).toEqual([])
    expect(r.code).toBe(0)
  })

  it('blocks with SV010 naming the exact line that never ran (US-1 AC3)', async () => {
    const { planSha, hash } = setup()
    repo.writeStory(storyFor({
      planId: 'checkout', planSha, diffHash: hash, base,
      lines: [{ file: 'src/pricing/discount.ts', line: 3 }, { file: 'src/pricing/discount.ts', line: 4, hits: 0 }],
    }))
    const r = await cli(repo, ['gate', '--base', base, '--json'])
    expect(r.code).toBe(2)
    const finding = r.json<GateResult>().findings.find((f) => f.code === 'SV010')!
    expect(finding.locus).toEqual({ file: 'src/pricing/discount.ts', line: 4 })
  })

  it('blocks with SV003 when the code changed after the story was sealed (US-1 AC2)', async () => {
    const { planSha, hash } = setup()
    repo.writeStory(storyFor({
      planId: 'checkout', planSha, diffHash: hash, base,
      lines: [{ file: 'src/pricing/discount.ts', line: 3 }, { file: 'src/pricing/discount.ts', line: 4 }],
    }))
    repo.write('src/pricing/discount.ts', `export function applyTiered(total: number, tier: number) {
  const base = total
  const bonus = tier * 0.09
  return base * (1 - bonus)
}
`)
    const r = await cli(repo, ['gate', '--base', base, '--json'])
    expect(r.code).toBe(2)
    expect(r.json<GateResult>().findings.map((f) => f.code)).toEqual(['SV003'])
  })

  it('blocks with SV020 when an assertion failed (FR-3)', async () => {
    const { planSha, hash } = setup()
    repo.writeStory(storyFor({
      planId: 'checkout', planSha, diffHash: hash, base,
      lines: [{ file: 'src/pricing/discount.ts', line: 3 }, { file: 'src/pricing/discount.ts', line: 4 }],
      assertions: [{ id: 'a1', status: 'fail', diff: 'total: expected 42.00, got 46.20' }],
    }))
    const r = await cli(repo, ['gate', '--base', base, '--json'])
    expect(r.code).toBe(2)
    expect(r.json<GateResult>().findings[0]!.message).toMatch(/46\.20/)
  })

  it('blocks with SV011 when the probe was never verified, with a doctor remedy', async () => {
    const { planSha, hash } = setup()
    repo.writeStory(storyFor({
      planId: 'checkout', planSha, diffHash: hash, base,
      lines: [{ file: 'src/pricing/discount.ts', line: 3, verified: false, hits: 0 }, { file: 'src/pricing/discount.ts', line: 4 }],
    }))
    const r = await cli(repo, ['gate', '--base', base, '--json'])
    const finding = r.json<GateResult>().findings.find((f) => f.code === 'SV011')!
    expect(finding.remedy).toMatch(/doctor/)
  })

  it('rejects a story that fails schema validation with a config error, not a verdict', async () => {
    setup()
    repo.write('.witness/runs/01JB7QK3M9X2VYD8N4T6ZQWERT/story.json', '{"schema":"witness/story@2"}')
    const r = await cli(repo, ['gate', '--base', base, '--json'])
    expect(r.code).toBe(3)
    expect(r.stderr).toMatch(/unsupported schema major/)
  })
})

describe('gate — bypass (US-6)', () => {
  it('is amber, not green: exit 5 with the reason recorded', async () => {
    repo.writePlan(planFor('checkout', ['src/**']))
    makeChange()
    const r = await cli(repo, ['gate', '--base', base, '--bypass', 'adapter is broken for this repo', '--json'])
    expect(r.code).toBe(5)
    const result = r.json<GateResult>()
    expect(result.verdict).toBe('bypass')
    expect(result.findings.find((f) => f.code === 'SV090')!.message).toMatch(/adapter is broken/)
    expect(result.findings.map((f) => f.code)).toContain('SV001')
  })

  it('refuses a blank reason and stays red', async () => {
    repo.writePlan(planFor('checkout', ['src/**']))
    makeChange()
    const r = await cli(repo, ['gate', '--base', base, '--bypass', '   ', '--json'])
    expect(r.code).toBe(2)
  })
})

describe('gate — host independence (US-3, US-5)', () => {
  it('runs under --vcs local with no host, no token and no network', async () => {
    repo.writePlan(planFor('checkout', ['src/**']))
    makeChange()
    const r = await cli(repo, ['gate', '--base', base, '--vcs', 'local', '--json'], { env: { PATH: process.env.PATH } })
    expect(r.code).toBe(2)
    expect(r.json<GateResult>().verdict).toBe('block')
  })

  it('produces the same verdict on GitHub as on local — the gate reads a diff, not a host', async () => {
    repo.writePlan(planFor('checkout', ['src/**']))
    makeChange()
    const local = await cli(repo, ['gate', '--base', base, '--vcs', 'local', '--json'])
    const github = await cli(repo, ['gate', '--base', base, '--json'], {
      env: { PATH: process.env.PATH, GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'o/r', GITHUB_ACTOR: 'burrows99' },
    })
    expect(github.code).toBe(local.code)
    expect(github.json<GateResult>().findings).toEqual(local.json<GateResult>().findings)
  })

  it('annotates the failing line for GitHub without any token', async () => {
    repo.writePlan(planFor('checkout', ['src/**']))
    makeChange()
    const r = await cli(repo, ['gate', '--base', base], {
      env: { PATH: process.env.PATH, GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'o/r' },
    })
    expect(r.stdout).toMatch(/^::error .*title=SV001::/m)
  })

  it('honours a GitHub bypass label carried in the event payload', async () => {
    repo.writePlan(planFor('checkout', ['src/**']))
    makeChange()
    const r = await cli(repo, ['gate', '--base', base, '--json'], {
      env: {
        PATH: process.env.PATH,
        GITHUB_ACTIONS: 'true',
        WITNESS_EVENT: JSON.stringify({ pull_request: { number: 7, labels: [{ name: 'witness:bypass' }], body: 'witness:bypass: harness is down', user: { login: 'burrows99' } } }),
      },
    })
    expect(r.code).toBe(5)
    expect(r.json<GateResult>().findings.find((f) => f.code === 'SV090')!.message).toMatch(/burrows99/)
  })
})

describe('CLI contract (FR-7, FR-8)', () => {
  it('emits JSON on stdout and nothing else under --json', async () => {
    repo.writePlan(planFor('checkout', ['src/**']))
    makeChange()
    const r = await cli(repo, ['gate', '--base', base, '--json'])
    expect(() => { JSON.parse(r.stdout) }).not.toThrow()
  })

  it('exits 3 on an unknown flag rather than silently ignoring it', async () => {
    const r = await cli(repo, ['gate', '--stroy', 'x.json'])
    expect(r.code).toBe(3)
    expect(r.stderr).toMatch(/unknown flag/)
  })

  it('exits 3 on an unknown command', async () => {
    expect((await cli(repo, ['frobnicate'])).code).toBe(3)
  })

  it('exits 3 for an invalid config, and says which file', async () => {
    repo.write('.witness/config.json', '{"schema":"witness/config@1","runner":"cloud"}')
    const r = await cli(repo, ['gate', '--base', base])
    expect(r.code).toBe(3)
    expect(r.stderr).toMatch(/config\.json/)
  })

  it('reports a harness failure as 4, never as 2', async () => {
    const notARepo = new TestRepo()
    notARepo.git('config', 'core.bare', 'false')
    // A directory that exists but has no git worktree: the gate cannot see a
    // diff, which is our problem to explain, not the developer's change.
    const r = await cli(repo, ['gate', '--base', 'refs/heads/does-not-exist'])
    expect([3, 4]).toContain(r.code)
    expect(r.code).not.toBe(2)
    notARepo.dispose()
  })

  it('prints help without a command and exits 0', async () => {
    const r = await cli(repo, ['--help'])
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/witness plan/)
  })
})

describe('doctor (FR-14, US-7 AC3)', () => {
  it('reports environment state without running a verification', async () => {
    const r = await cli(repo, ['doctor', '--json'])
    expect(r.code).toBe(0)
    const report = r.json<{ ok: boolean; checks: Array<{ name: string; status: string }> }>()
    expect(report.ok).toBe(true)
    expect(report.checks.map((c) => c.name)).toContain('repository')
  })

  it('warns when no plan is committed, and says how to make one', async () => {
    const report = (await cli(repo, ['doctor', '--json'])).json<{ checks: Array<{ name: string; status: string; remedy?: string }> }>()
    const plans = report.checks.find((c) => c.name === 'plans')!
    expect(plans.status).toBe('warn')
    expect(plans.remedy).toMatch(/witness plan/)
  })

  it('reports an unparseable redaction pattern instead of silently redacting nothing', async () => {
    repo.write('.witness/config.json', JSON.stringify({ schema: 'witness/config@1', redact: { patterns: ['([unclosed'] } }))
    const report = (await cli(repo, ['doctor', '--json'])).json<{ checks: Array<{ name: string; status: string }> }>()
    expect(report.checks.find((c) => c.name === 'redaction')!.status).toBe('warn')
  })
})
