import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TestRepo, cli, planFor } from '../helpers/repo.js'

/**
 * L2 — `swe-verify skill`, end to end in a real project.
 *
 * The point of generating rather than writing the skill is that it tracks the
 * project. These tests pin that: add a plan, and the skill says so; leave it
 * alone, and regenerating is a no-op; let it drift, and `--check` fails in CI.
 */

let repo: TestRepo

beforeEach(() => {
  repo = new TestRepo()
  repo.write('src/pricing/discount.ts', 'export const rate = 0.1\n')
  repo.write('package.json', JSON.stringify({ name: 'acme-checkout', version: '1.0.0' }, null, 2))
  repo.write('.swe-verify/config.json', JSON.stringify({ schema: 'swe-verify/config@1', vcs: 'local' }))
  repo.commit('base')
})
afterEach(() => repo.dispose())

const DEFAULT_PATH = join('.claude', 'skills', 'verify-acme-checkout', 'SKILL.md')
const read = (path = DEFAULT_PATH) => readFileSync(join(repo.dir, path), 'utf8')

describe('swe-verify skill — one command, any project root', () => {
  it('writes a skill where Claude Code discovers project skills', async () => {
    const result = await cli(repo, ['skill', '--json'])
    expect(result.code).toBe(0)
    expect(result.json<{ path: string }>().path).toBe(DEFAULT_PATH)
    expect(existsSync(join(repo.dir, DEFAULT_PATH))).toBe(true)
  })

  it('names the skill after the project it verifies', async () => {
    await cli(repo, ['skill'])
    expect(read()).toMatch(/^name: verify-acme-checkout$/m)
  })

  it('falls back to the directory name when there is no package.json', async () => {
    const bare = new TestRepo()
    try {
      bare.write('src/a.py', 'x = 1\n')
      bare.commit('base')
      const result = await cli(bare, ['skill', '--json'])
      expect(result.code).toBe(0)
      expect(result.json<{ name: string }>().name).toMatch(/^verify-[a-z0-9-]+$/)
    } finally { bare.dispose() }
  })

  it('writes wherever it is told, for a project that keeps skills elsewhere', async () => {
    const result = await cli(repo, ['skill', '--out', 'SKILL.md', '--json'])
    expect(result.json<{ path: string }>().path).toBe('SKILL.md')
    expect(read('SKILL.md')).toMatch(/^name: verify-acme-checkout$/m)
  })

  it('creates the directories it needs', async () => {
    await cli(repo, ['skill', '--out', 'docs/deep/nested/SKILL.md'])
    expect(existsSync(join(repo.dir, 'docs/deep/nested/SKILL.md'))).toBe(true)
  })
})

describe('the skill is generated from the project, so it evolves with it', () => {
  it('says the project has no plans, before there are any', async () => {
    await cli(repo, ['skill'])
    expect(read()).toMatch(/no plans/i)
  })

  it('routes to a plan as soon as one is committed', async () => {
    repo.writePlan(planFor('checkout', ['src/pricing/**'], { intent: 'checkout applies the tiered discount' }))
    await cli(repo, ['skill'])
    const skill = read()
    expect(skill).toMatch(/`checkout`/)
    expect(skill).toMatch(/checkout applies the tiered discount/)
    expect(skill).toMatch(/src\/pricing\/\*\*/)
  })

  it('picks up a second plan without being told about it', async () => {
    repo.writePlan(planFor('checkout', ['src/pricing/**']))
    await cli(repo, ['skill'])
    expect(read()).not.toMatch(/`refunds`/)

    repo.writePlan(planFor('refunds', ['src/refunds/**']))
    await cli(repo, ['skill'])
    expect(read()).toMatch(/`refunds`/)
  })

  it('follows a policy change in config', async () => {
    await cli(repo, ['skill'])
    expect(read()).toMatch(/at most \*\*10%\*\*/)

    repo.write('.swe-verify/config.json', JSON.stringify({
      schema: 'swe-verify/config@1',
      vcs: 'local',
      coverage: { policy: 'all-executable', defensive: 'require', waiverCapPct: 3 },
    }))
    await cli(repo, ['skill'])
    const skill = read()
    expect(skill).toMatch(/at most \*\*3%\*\*/)
    expect(skill).toMatch(/require/)
  })

  it('reports the adapters actually present in this environment', async () => {
    await cli(repo, ['skill'], { env: { PATH: process.env.PATH, SWE_VERIFY_PYTHON: join(process.cwd(), '.venv', 'bin', 'python') } })
    expect(read()).toMatch(/\*\*py\*\* \(debugpy\)/)
  })

  it('names what it cannot gate, with the remedy', async () => {
    await cli(repo, ['skill'])
    const skill = read()
    expect(skill).toMatch(/SV016/)
    expect(skill).toMatch(/js-debug/)
  })

  it('regenerating an unchanged project rewrites the same bytes', async () => {
    repo.writePlan(planFor('checkout', ['src/pricing/**']))
    await cli(repo, ['skill'])
    const first = read()
    await cli(repo, ['skill'])
    expect(read()).toBe(first)
  })
})

describe('--check — how the skill stays fresh in CI', () => {
  it('passes when the skill matches the project', async () => {
    await cli(repo, ['skill'])
    const result = await cli(repo, ['skill', '--check', '--json'])
    expect(result.code).toBe(0)
    expect(result.json<{ stale: boolean }>().stale).toBe(false)
  })

  it('fails when the project has moved on', async () => {
    await cli(repo, ['skill'])
    repo.writePlan(planFor('refunds', ['src/refunds/**']))

    const result = await cli(repo, ['skill', '--check', '--json'])
    expect(result.code).toBe(3)
    expect(result.json<{ stale: boolean }>().stale).toBe(true)
  })

  it('says how to fix it rather than just failing', async () => {
    await cli(repo, ['skill'])
    repo.writePlan(planFor('refunds', ['src/refunds/**']))
    const result = await cli(repo, ['skill', '--check'])
    expect(result.stderr).toMatch(/swe-verify skill/)
  })

  it('fails when the skill has never been generated', async () => {
    expect((await cli(repo, ['skill', '--check'])).code).toBe(3)
  })

  it('fails when someone hand-edited the generated file', async () => {
    await cli(repo, ['skill'])
    writeFileSync(join(repo.dir, DEFAULT_PATH), `${read()}\n\nHand-written addition.\n`)
    expect((await cli(repo, ['skill', '--check'])).code).toBe(3)
  })

  it('does not write anything while checking', async () => {
    const result = await cli(repo, ['skill', '--check'])
    expect(result.code).toBe(3)
    expect(existsSync(join(repo.dir, DEFAULT_PATH))).toBe(false)
  })
})

describe('the generated skill is valid, portable Agent Skills frontmatter', () => {
  it('uses only the six fields the spec defines', async () => {
    repo.writePlan(planFor('checkout', ['src/pricing/**']))
    await cli(repo, ['skill'])
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(read())![1]!
    const keys = [...frontmatter.matchAll(/^([a-z-]+):/gm)].map((m) => m[1]!)
    for (const key of keys) {
      expect(['name', 'description', 'license', 'metadata', 'allowed-tools', 'compatibility']).toContain(key)
    }
  })

  it('is a single self-describing file with no supporting assets to lose', async () => {
    await cli(repo, ['skill'])
    expect(read()).not.toMatch(/\$\{CLAUDE_SKILL_DIR\}/)
  })
})
