import { describe, expect, it } from 'vitest'
import { terminalMatch } from '../../../src/core/assertions.js'
import type { AssertionResult, StoryView as _StoryView } from '../../../src/core/index.js'

/** `terminal-match` never awaits — it reads text the run already wrote. */
const check = (spec: Record<string, unknown>, view: _StoryView): AssertionResult =>
  terminalMatch.evaluate(spec, view, 0) as AssertionResult
import type { StoryArtifact, StoryView } from '../../../src/core/index.js'

/**
 * `terminal-match` — asserting on what the recording actually showed.
 *
 * Before this existed, a plan driven by a process fixture could not assert
 * anything at all: the three assertion kinds that shipped all read an HTTP
 * response or a live page, and a Go test binary produces neither. So every
 * such plan carried `assertions: []` and earned SV021 — "the run proves the
 * code was exercised, not that it behaved" — permanently, with no way out
 * that was not weakening something.
 *
 * The transcript is the artefact this reads. It is the same text a reviewer
 * sees in the video, which is what makes a green assertion and a green
 * recording the same claim rather than two unrelated ones.
 */

const transcript = (text: string, path = 'artifacts/transcript/terminal.txt'): StoryView => {
  const artifact: StoryArtifact = {
    kind: 'transcript', path, sha256: 'a'.repeat(64), bytes: text.length, readableBy: ['agent'],
  }
  return {
    stepResult: () => undefined,
    events: () => [],
    artifacts: () => [artifact],
    readText: (wanted) => (wanted === path ? text : null),
  }
}

const PASS = '### the rule is deleted\n--- PASS: TestRuleRoutine (0.00s)\nPASS\nok  \tpkg/schedule\t1.09s\n'
const FAIL = '### the rule is deleted\n    Error: Received unexpected error:\n    context canceled\n--- FAIL: TestRuleRoutine (0.00s)\nFAIL\n'

describe('terminal-match', () => {
  it('passes when the transcript contains what the plan claimed it would', () => {
    expect(check({ contains: '--- PASS: TestRuleRoutine' }, transcript(PASS)))
      .toMatchObject({ status: 'pass' })
  })

  it('fails when it does not, and says what it looked for', () => {
    const result = check({ contains: '--- PASS: TestRuleRoutine' }, transcript(FAIL))
    expect(result).toMatchObject({ status: 'fail' })
    expect((result as { diff?: string }).diff).toMatch(/PASS: TestRuleRoutine/)
  })

  it('asserts on absence, which is how a reproduction proves the bug is gone', () => {
    expect(check({ absent: 'FAIL' }, transcript(PASS))).toMatchObject({ status: 'pass' })
    expect(check({ absent: 'FAIL' }, transcript(FAIL))).toMatchObject({ status: 'fail' })
  })

  it('supports a pattern, for output that carries a timing or a path', () => {
    expect(check({ matches: '^ok\\s+\\S+\\s+[\\d.]+s$' }, transcript(PASS)))
      .toMatchObject({ status: 'pass' })
  })

  it('reports an unusable pattern rather than passing or crashing', () => {
    const result = check({ matches: '([unclosed' }, transcript(PASS))
    expect(result.status).toBe('fail')
    expect((result as { diff?: string }).diff).toMatch(/pattern/i)
  })

  it('requires every stated expectation to hold, not just one', () => {
    expect(check({ contains: 'PASS', absent: 'FAIL' }, transcript(PASS)))
      .toMatchObject({ status: 'pass' })
    expect(check({ contains: 'PASS', absent: 'ok' }, transcript(PASS)))
      .toMatchObject({ status: 'fail' })
  })

  it('is skipped, never passed, when the run produced no transcript', () => {
    // A green gate has to mean something was checked. An assertion that
    // silently passes because its evidence is missing is the exact failure
    // SV021 exists to warn about.
    const empty: StoryView = {
      stepResult: () => undefined, events: () => [], artifacts: () => [], readText: () => null,
    }
    expect(check({ contains: 'PASS' }, empty)).toMatchObject({ status: 'skipped' })
  })

  it('is skipped when the transcript exists but could not be read', () => {
    const artifact: StoryArtifact = {
      kind: 'transcript', path: 'artifacts/transcript/terminal.txt', sha256: 'a'.repeat(64), bytes: 10, readableBy: ['agent'],
    }
    const unreadable: StoryView = {
      stepResult: () => undefined, events: () => [], artifacts: () => [artifact], readText: () => null,
    }
    expect(check({ contains: 'PASS' }, unreadable)).toMatchObject({ status: 'skipped' })
  })

  it('refuses an assertion that expects nothing, rather than passing it', () => {
    // `expect: {}` would otherwise pass against any transcript at all, which
    // is a green assertion that checked nothing.
    expect(check({}, transcript(PASS)).status).toBe('fail')
  })

  it('names the artefact it read, so a reviewer can open the same text', () => {
    const result = check({ contains: 'nope' }, transcript(PASS))
    expect((result as { diff?: string }).diff).toMatch(/transcript/)
  })
})
