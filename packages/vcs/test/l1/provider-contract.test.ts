import { describe, expect, it } from 'vitest'
import { createProvider, detectProvider, PROVIDERS } from '../../src/index.js'
import type { PublishTarget, VcsEnv } from '../../src/types.js'
import type { GateResult } from '@macquery-labs/core'

/**
 * L1 — the VcsProvider contract, run against every implementation.
 *
 * "`local` is the proof": if the gate cannot run with no host, no token and
 * no network, a host has become load-bearing (TDD §7.7). Every provider here
 * runs offline; none of them may make a network call in the free path.
 */

const result = (over: Partial<GateResult> = {}): GateResult => ({
  verdict: 'block',
  findings: [
    { code: 'SV010', severity: 'error', message: 'changed line never executed: src/a.ts:41', remedy: 'Add a step that reaches it.', locus: { file: 'src/a.ts', line: 41 } },
    { code: 'SV021', severity: 'warn', message: 'plan has no assertions', remedy: 'Add one.' },
  ],
  metrics: { executable: 2, fired: 1, unverified: 0, waived: 0, defensive: 0, assertionsPassed: 0, assertionsTotal: 0 },
  ...over,
})

class Recorder implements PublishTarget {
  lines: string[] = []
  summaries: string[] = []
  write(line: string) { this.lines.push(line) }
  summary(markdown: string) { this.summaries.push(markdown) }
}

const envFor: Record<string, VcsEnv> = {
  local: {},
  github: { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'o/r', GITHUB_ACTOR: 'burrows99', GITHUB_REF_NAME: '1234/merge' },
  gitlab: { GITLAB_CI: 'true', CI_MERGE_REQUEST_IID: '77', GITLAB_USER_LOGIN: 'burrows99' },
  bitbucket: { BITBUCKET_BUILD_NUMBER: '9', BITBUCKET_PR_ID: '12' },
}

describe.each(PROVIDERS)('VcsProvider contract: %s', (name) => {
  const env = envFor[name]!

  it('reports its own name', () => {
    expect(createProvider(name, { env }).name).toBe(name)
  })

  it('describes the change without a network call', async () => {
    const ctx = await createProvider(name, { env }).describe()
    expect(ctx.provider).toBe(name)
  })

  it('returns no bypass when nothing signals one', async () => {
    expect(await createProvider(name, { env }).resolveBypass()).toBeNull()
  })

  it('resolves an explicit bypass reason passed on the command line', async () => {
    const bypass = await createProvider(name, { env, bypassReason: 'gate is wrong about generated code' }).resolveBypass()
    expect(bypass?.reason).toBe('gate is wrong about generated code')
  })

  it('refuses a blank bypass reason', async () => {
    expect(await createProvider(name, { env, bypassReason: '   ' }).resolveBypass()).toBeNull()
  })

  it('publishes a verdict that names every error finding', async () => {
    const target = new Recorder()
    await createProvider(name, { env }).publish(result(), target)
    const all = [...target.lines, ...target.summaries].join('\n')
    expect(all).toMatch(/SV010/)
    expect(all).toMatch(/src\/a\.ts/)
    expect(all).toMatch(/41/)
  })

  it('publishes the remedy, not just the message', async () => {
    const target = new Recorder()
    await createProvider(name, { env }).publish(result(), target)
    expect([...target.lines, ...target.summaries].join('\n')).toMatch(/Add a step that reaches it/)
  })

  it('marks a bypass as amber rather than green', async () => {
    const target = new Recorder()
    await createProvider(name, { env }).publish(result({ verdict: 'bypass' }), target)
    expect([...target.lines, ...target.summaries].join('\n').toLowerCase()).toMatch(/bypass/)
  })

  it('publishes an allow verdict too — a green run is still evidence', async () => {
    const target = new Recorder()
    await createProvider(name, { env }).publish(result({ verdict: 'allow', findings: [] }), target)
    expect([...target.lines, ...target.summaries].join('\n')).not.toBe('')
  })
})

describe('detectProvider — selected by flag, else environment, else local', () => {
  it('detects GitHub Actions', () => {
    expect(detectProvider({ GITHUB_ACTIONS: 'true' })).toBe('github')
  })
  it('detects GitLab CI', () => {
    expect(detectProvider({ GITLAB_CI: 'true' })).toBe('gitlab')
  })
  it('detects Bitbucket Pipelines', () => {
    expect(detectProvider({ BITBUCKET_BUILD_NUMBER: '3' })).toBe('bitbucket')
  })
  it('falls back to local with an empty environment', () => {
    expect(detectProvider({})).toBe('local')
  })
  it('prefers an explicit choice over detection', () => {
    expect(detectProvider({ GITHUB_ACTIONS: 'true' }, 'local')).toBe('local')
  })
  it('resolves "auto" by detecting', () => {
    expect(detectProvider({ GITLAB_CI: 'true' }, 'auto')).toBe('gitlab')
  })
})

describe('host-specific bypass signals', () => {
  it('reads a GitHub PR label from the event payload, with a reason from the body', async () => {
    const env = {
      ...envFor.github,
      WITNESS_EVENT: JSON.stringify({
        pull_request: { number: 1234, labels: [{ name: 'witness:bypass' }], body: 'fixes stuff\nwitness:bypass: adapter is broken for this repo', user: { login: 'burrows99' } },
      }),
    }
    const bypass = await createProvider('github', { env }).resolveBypass()
    expect(bypass).toMatchObject({ reason: 'adapter is broken for this repo', actor: 'burrows99', source: 'label' })
  })

  it('refuses a GitHub bypass label with no reason anywhere', async () => {
    const env = { ...envFor.github, WITNESS_EVENT: JSON.stringify({ pull_request: { number: 1, labels: [{ name: 'witness:bypass' }], body: '' } }) }
    expect(await createProvider('github', { env }).resolveBypass()).toBeNull()
  })

  it('ignores an unrelated GitHub label', async () => {
    const env = { ...envFor.github, WITNESS_EVENT: JSON.stringify({ pull_request: { number: 1, labels: [{ name: 'bug' }], body: 'witness:bypass: nope' } }) }
    expect(await createProvider('github', { env }).resolveBypass()).toBeNull()
  })

  it('reads a GitLab MR label from CI_MERGE_REQUEST_LABELS', async () => {
    const env = { ...envFor.gitlab, CI_MERGE_REQUEST_LABELS: 'urgent,witness:bypass', CI_MERGE_REQUEST_DESCRIPTION: 'witness:bypass: flaky adapter' }
    const bypass = await createProvider('gitlab', { env }).resolveBypass()
    expect(bypass).toMatchObject({ reason: 'flaky adapter', source: 'label' })
  })

  it('carries the change id into the published context', async () => {
    expect((await createProvider('github', { env: envFor.github! }).describe()).changeId).toBe('1234')
    expect((await createProvider('gitlab', { env: envFor.gitlab! }).describe()).changeId).toBe('77')
    expect((await createProvider('bitbucket', { env: envFor.bitbucket! }).describe()).changeId).toBe('12')
  })
})

describe('GitHub publishing uses workflow commands, so the free path needs no token', () => {
  it('emits ::error annotations with file and line', async () => {
    const target = new Recorder()
    await createProvider('github', { env: envFor.github! }).publish(result(), target)
    expect(target.lines.some((l) => l.startsWith('::error file=src/a.ts,line=41,title=SV010::'))).toBe(true)
  })
  it('emits ::warning for warn-severity findings', async () => {
    const target = new Recorder()
    await createProvider('github', { env: envFor.github! }).publish(result(), target)
    expect(target.lines.some((l) => l.startsWith('::warning'))).toBe(true)
  })
  it('writes a job summary table', async () => {
    const target = new Recorder()
    await createProvider('github', { env: envFor.github! }).publish(result(), target)
    expect(target.summaries.join('\n')).toMatch(/\|\s*`?SV010`?\s*\|/)
  })
})
