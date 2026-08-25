import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configSource, loadConfig, loadPlans, planSha, scaffold, runDir, writeStory, readStory } from '../../src/workspace.js'
import type { Story } from '@witness/core'
import { UsageError } from '../../src/errors.js'
import { withReversedKeys } from '../../../../test/helpers/objects.js'
import { diffAgainst, gitHeadSha, isGitRepo, mergeBase } from '../../src/git.js'

let dir: string
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'witness-ws-'))
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'test')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const commit = (message: string) => { git('add', '-A'); git('commit', '-q', '-m', message) }

describe('scaffold + loadConfig', () => {
  it('writes a config that resolves to the free tier', () => {
    scaffold(dir)
    const config = loadConfig(dir)
    expect(config.runner).toBe('local')
    expect(config.telemetry).toBe('off')
    expect(config.artifactStore).toBe('fs')
  })

  it('is idempotent — running init twice does not clobber edits', () => {
    scaffold(dir)
    const path = join(dir, '.witness', 'config.json')
    const edited = { ...JSON.parse(readFileSync(path, 'utf8')), domain: 'data-engineering' }
    writeFileSync(path, JSON.stringify(edited))
    scaffold(dir)
    expect(loadConfig(dir).domain).toBe('data-engineering')
  })

  it('falls back to defaults when there is no config at all', () => {
    expect(loadConfig(dir).coverage.defensive).toBe('warn')
  })

  it('rejects an invalid config with a usage error, not a crash', () => {
    mkdirSync(join(dir, '.witness'), { recursive: true })
    writeFileSync(join(dir, '.witness', 'config.json'), '{"schema":"witness/config@1","runner":"cloud"}')
    expect(() => loadConfig(dir)).toThrow(UsageError)
  })

  it('rejects unparseable JSON with a usage error naming the file', () => {
    mkdirSync(join(dir, '.witness'), { recursive: true })
    writeFileSync(join(dir, '.witness', 'config.json'), '{oops')
    expect(() => loadConfig(dir)).toThrow(/config\.json/)
  })
})

describe('loadPlans', () => {
  const writePlan = (name: string, over: Record<string, unknown> = {}) => {
    mkdirSync(join(dir, '.witness', 'plans'), { recursive: true })
    const plan = {
      schema: 'witness/plan@1',
      id: name,
      intent: 'prove it',
      scope: { include: ['src/**'] },
      steps: [{ seq: 1, driver: 'api', action: 'get', args: { path: '/' } }],
      assertions: [{ id: 'a1', kind: 'http-status', afterStep: 1, expect: { status: 200 } }],
      ...over,
    }
    writeFileSync(join(dir, '.witness', 'plans', `${name}.plan.json`), JSON.stringify(plan, null, 2))
    return plan
  }

  it('loads every committed plan as a PlanRef', () => {
    writePlan('checkout')
    writePlan('signup')
    const plans = loadPlans(dir)
    expect(plans.map((p) => p.id).sort()).toEqual(['checkout', 'signup'])
    expect(plans[0]!.sha256).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('returns an empty list when no plans are committed', () => {
    expect(loadPlans(dir)).toEqual([])
  })

  it('rejects an invalid plan with a usage error naming the file', () => {
    mkdirSync(join(dir, '.witness', 'plans'), { recursive: true })
    writeFileSync(join(dir, '.witness', 'plans', 'bad.plan.json'), '{"schema":"witness/plan@1"}')
    expect(() => loadPlans(dir)).toThrow(/bad\.plan\.json/)
  })

  it('carries waivers and assertion counts through to the gate', () => {
    writePlan('checkout', { coverage: { waivers: [{ file: 'src/a.ts', lines: '1-2', reason: 'guard', expires: '2027-01-01' }] } })
    const plan = loadPlans(dir)[0]!
    expect(plan.waivers).toHaveLength(1)
    expect(plan.assertionCount).toBe(1)
  })

  it('hashes the plan canonically, so reformatting it does not stale a story', () => {
    const plan = writePlan('checkout')
    const a = planSha(plan)
    const reordered = withReversedKeys(plan)
    expect(Object.keys(reordered)).not.toEqual(Object.keys(plan))
    expect(planSha(reordered)).toBe(a)
  })

  it('changes the plan hash when the plan actually changes', () => {
    const plan = writePlan('checkout')
    const a = planSha(plan)
    expect(planSha({ ...plan, intent: 'prove something else' })).not.toBe(a)
  })
})

describe('git integration', () => {
  it('recognises a repository, and reports a non-repository as such', () => {
    expect(isGitRepo(dir)).toBe(true)
    expect(isGitRepo(mkdtempSync(join(tmpdir(), 'not-a-repo-')))).toBe(false)
  })

  it('computes a diff against a base commit', () => {
    writeFileSync(join(dir, 'a.ts'), 'const a = 1\n')
    commit('base')
    const base = gitHeadSha(dir)
    writeFileSync(join(dir, 'a.ts'), 'const a = 1\nconst b = 2\n')
    commit('change')

    const diff = diffAgainst(dir, base)
    expect(diff.files).toHaveLength(1)
    expect(diff.files[0]!.path).toBe('a.ts')
    expect(diff.files[0]!.lines[0]!.text).toBe('const b = 2')
  })

  it('includes uncommitted working-tree changes, so the gate can run pre-commit', () => {
    writeFileSync(join(dir, 'a.ts'), 'const a = 1\n')
    commit('base')
    const base = gitHeadSha(dir)
    writeFileSync(join(dir, 'a.ts'), 'const a = 1\nconst uncommitted = 3\n')

    expect(diffAgainst(dir, base).files[0]!.lines[0]!.text).toBe('const uncommitted = 3')
  })

  it('finds the merge base of a feature branch', () => {
    writeFileSync(join(dir, 'a.ts'), 'const a = 1\n')
    commit('base')
    const base = gitHeadSha(dir)
    git('checkout', '-q', '-b', 'feature')
    writeFileSync(join(dir, 'a.ts'), 'const a = 2\n')
    commit('feature work')
    expect(mergeBase(dir, 'main')).toBe(base)
  })

  it('reports an unknown base ref as a usage error, not a harness failure', () => {
    writeFileSync(join(dir, 'a.ts'), 'x\n')
    commit('base')
    expect(() => diffAgainst(dir, 'no-such-ref')).toThrow(UsageError)
  })

  it('produces an empty normalised diff when nothing changed', () => {
    writeFileSync(join(dir, 'a.ts'), 'const a = 1\n')
    commit('base')
    expect(diffAgainst(dir, gitHeadSha(dir)).isEmpty).toBe(true)
  })
})

describe('run directory', () => {
  it('writes and reads back a story under .witness/runs/<id>', () => {
    const story = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'story.json'), 'utf8')) as Story
    const path = writeStory(dir, story.run_id, story)
    expect(path).toContain(join('.witness', 'runs', story.run_id))
    expect(readStory(path).run_id).toBe(story.run_id)
  })

  it('rejects a story that fails schema validation on read', () => {
    const path = join(runDir(dir, '01JB7QK3M9X2VYD8N4T6ZQWERT'), 'story.json')
    mkdirSync(join(dir, '.witness', 'runs', '01JB7QK3M9X2VYD8N4T6ZQWERT'), { recursive: true })
    writeFileSync(path, '{"schema":"witness/story@1"}')
    expect(() => readStory(path)).toThrow(/invalid story .*required property 'run_id'/s)
  })
})

describe('doctor says where the config came from', () => {
  /**
   * An agent branched from a commit that predated the gate config, so git
   * correctly removed the tracked `.witness/config.json` from the working
   * tree — and every run on that branch quietly used built-in budgets. It ran
   * forty minutes against a ten-minute default before anyone noticed, because
   * `doctor` reported what the config *said* and never whether a file existed
   * at all. Values without provenance cannot answer "why is this budget
   * what it is?".
   */
  it('names the file when there is one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'witness-cfg-'))
    mkdirSync(join(dir, '.witness'), { recursive: true })
    writeFileSync(join(dir, '.witness', 'config.json'), JSON.stringify({ schema: 'witness/config@1' }))
    expect(configSource(dir)).toBe(join(dir, '.witness', 'config.json'))
  })

  it('reports nothing to load, rather than an empty string', () => {
    expect(configSource(mkdtempSync(join(tmpdir(), 'witness-cfg-')))).toBeNull()
  })
})
