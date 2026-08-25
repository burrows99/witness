import type { Plan, Story } from '../../src/types.js'

export { withReversedKeys } from '../../../../test/helpers/objects.js'

export function minimalStory(): Story {
  return {
    schema: 'swe-verify/story@1',
    run_id: '01JB7QK3M9X2VYD8N4T6ZQWERT',
    plan_id: 'checkout-discount',
    plan_sha256: `sha256:${'a'.repeat(64)}`,
    diff: {
      hash: `sha256:${'9'.repeat(64)}`,
      algo: 'normalised-v1',
      base_sha: 'b'.repeat(40),
      head_sha: 'e'.repeat(40),
      files: 1,
      changed_lines: 1,
    },
    vcs: { provider: 'local' },
    env: { cli: '0.1.0', os: 'linux/amd64', runner: 'local', domain: 'fullstack' },
    started_at: '2026-08-24T10:11:02.401Z',
    sealed_at: '2026-08-24T10:11:19.883Z',
    events: [],
    coverage: {
      policy: 'all-executable',
      lines: [],
      summary: { executable: 0, fired: 0, unverified: 0, waived: 0, excluded: 0, defensive: 0 },
    },
    assertions: [],
    artifacts: [],
    diagnostics: [],
  }
}

export function minimalPlan(): Plan {
  return {
    schema: 'swe-verify/plan@1',
    id: 'checkout-discount',
    intent: 'checkout applies the tiered discount',
    domain: 'fullstack',
    scope: { include: ['src/pricing/**'] },
    steps: [{ seq: 1, driver: 'api', action: 'get', args: { path: '/orders/latest' } }],
    assertions: [{ id: 'a1', kind: 'http-status', afterStep: 1, expect: { status: 200 } }],
  }
}
