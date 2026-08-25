import type { AssertionKind, AssertionResult, StoryView } from './seams.js'
import { readString } from './planargs.js'

/**
 * Assertion kinds that need no driver.
 *
 * The three kinds that shipped first all read either an HTTP response or a
 * live page. A plan driven by a process fixture — a Go test binary, a job, a
 * CLI — produces neither, so it could not assert anything at all and carried
 * `assertions: []` permanently, earning SV021 for ever: "the run proves the
 * code was exercised, not that it behaved". The only ways out were to weaken
 * something or to give up on the claim.
 *
 * `terminal-match` reads the transcript a recorder produced. That matters
 * beyond convenience: it is the same text a reviewer watches in the video, so
 * a green assertion and a green recording are one claim rather than two
 * unrelated ones that happen to sit in the same pull request.
 */

/** The transcript a terminal recording leaves behind, if there is one. */
function transcriptOf(view: StoryView): { path: string; text: string } | null {
  for (const artifact of view.artifacts()) {
    if (artifact.kind !== 'transcript') continue
    const text = view.readText(artifact.path)
    if (text !== null) return { path: artifact.path, text }
  }
  return null
}

export const terminalMatch: AssertionKind = {
  kind: 'terminal-match',
  evaluate(spec, view): AssertionResult {
    const contains = spec.contains === undefined ? null : readString(spec, 'contains', '')
    const absent = spec.absent === undefined ? null : readString(spec, 'absent', '')
    const matches = spec.matches === undefined ? null : readString(spec, 'matches', '')

    if (contains === null && absent === null && matches === null) {
      // `expect: {}` would pass against any transcript ever produced, which
      // is a green assertion that checked nothing.
      return {
        status: 'fail',
        diff: 'terminal-match needs at least one of "contains", "absent" or "matches"; an empty expectation would pass against anything',
      }
    }

    const transcript = transcriptOf(view)
    if (!transcript) {
      // Skipped, never passed: a green gate has to mean something was
      // checked, and an assertion whose evidence is missing checked nothing.
      return {
        status: 'skipped',
        diff: 'the run produced no readable transcript to assert on — record the plan (--record) so there is one',
      }
    }

    const failures: string[] = []
    if (contains !== null && !transcript.text.includes(contains)) {
      failures.push(`expected the transcript to contain ${JSON.stringify(contains)}`)
    }
    if (absent !== null && transcript.text.includes(absent)) {
      failures.push(`expected the transcript not to contain ${JSON.stringify(absent)}`)
    }
    if (matches !== null) {
      let pattern: RegExp
      try {
        pattern = new RegExp(matches, 'm')
      } catch (error) {
        return { status: 'fail', diff: `"${matches}" is not a usable pattern: ${(error as Error).message}` }
      }
      if (!pattern.test(transcript.text)) failures.push(`expected the transcript to match /${matches}/m`)
    }

    if (failures.length === 0) {
      return { status: 'pass', expected: spec, actual: `${transcript.path} (${transcript.text.length} chars)` }
    }
    return {
      status: 'fail',
      expected: spec,
      actual: transcript.path,
      diff: `${failures.join('; ')} — read ${transcript.path}`,
    }
  },
}

/** Assertion kinds available in every run, whatever drivers it uses. */
export function builtinAssertionKinds(): AssertionKind[] {
  return [terminalMatch]
}
