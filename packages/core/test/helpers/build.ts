import { normaliseDiff, diffHash, type NormalisedDiff } from '../../src/diff.js'
import { DEFAULT_CONFIG } from '../../src/schema.js'
import type { CoverageLine, PlanRef, ResolvedConfig, Story, StoryAssertion } from '../../src/types.js'

/** A one-file diff with `count` executable added lines starting at line 40. */
export function diffOf(file = 'src/pricing/discount.ts', texts: string[] = ['const bonus = 1', 'return bonus']): NormalisedDiff {
  const body = texts.map((t) => `+${t}`).join('\n')
  const patch = [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -39,1 +39,${texts.length + 1} @@`,
    ' const base = total',
    body,
  ].join('\n')
  return normaliseDiff(patch, { baseSha: 'b'.repeat(40), headSha: 'e'.repeat(40) })
}

export function planRef(over: Partial<PlanRef> = {}): PlanRef {
  return {
    id: 'checkout-discount',
    sha256: `sha256:${'a'.repeat(64)}`,
    scope: { include: ['src/**'] },
    waivers: [],
    assertionCount: 1,
    ...over,
  }
}

export function coverageFor(diff: NormalisedDiff, over: Partial<CoverageLine> = {}): CoverageLine[] {
  return diff.files.flatMap((f) =>
    f.lines.map((l, i) => ({
      file: f.path,
      line: l.line,
      class: l.class,
      probe_id: `p${i}`,
      verified: true,
      hits: 1,
      ...over,
    })),
  )
}

export function storyFor(
  diff: NormalisedDiff,
  over: Partial<Story> = {},
  lines: CoverageLine[] = coverageFor(diff),
  assertions: StoryAssertion[] = [{ id: 'a1', status: 'pass' }],
): Story {
  return {
    schema: 'witness/story@1',
    run_id: '01JB7QK3M9X2VYD8N4T6ZQWERT',
    plan_id: 'checkout-discount',
    plan_sha256: `sha256:${'a'.repeat(64)}`,
    diff: {
      hash: diffHash(diff),
      algo: diff.algo,
      base_sha: diff.baseSha ?? 'b'.repeat(40),
      head_sha: diff.headSha ?? 'e'.repeat(40),
      files: diff.files.length,
      changed_lines: diff.changedLines,
    },
    vcs: { provider: 'local' },
    env: { cli: '0.1.0', os: 'linux/arm64', runner: 'local', domain: 'fullstack' },
    started_at: '2026-08-24T10:11:02.401Z',
    sealed_at: '2026-08-24T10:11:19.883Z',
    events: [],
    coverage: {
      policy: 'all-executable',
      lines,
      summary: {
        executable: lines.filter((l) => l.class === 'executable').length,
        fired: lines.filter((l) => (l.hits ?? 0) > 0).length,
        unverified: lines.filter((l) => l.verified === false).length,
        waived: lines.filter((l) => l.class === 'waived').length,
        excluded: 0,
        defensive: lines.filter((l) => l.class === 'defensive').length,
      },
    },
    assertions,
    artifacts: [],
    diagnostics: [],
    ...over,
  }
}

export function policyOf(over: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return { ...DEFAULT_CONFIG, ...over }
}

export const NOW = new Date('2026-08-24T12:00:00.000Z')
