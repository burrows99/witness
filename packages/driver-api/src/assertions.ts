import { readString, type AssertionKind, type AssertionResult, type StoryView } from '@macquery-labs/core'

/**
 * Assertion kinds for the API tier.
 *
 * An assertion that cannot see its step is `skipped`, never `pass`: a green
 * gate has to mean something was checked, and silently passing a check that
 * never ran is the failure mode SV021 exists to warn about.
 */

function responseOf(view: StoryView, step: number): { status?: number; body?: unknown } | null {
  const data = view.stepResult(step)?.data
  return (data?.response as { status?: number; body?: unknown } | undefined) ?? null
}

export const httpStatus: AssertionKind = {
  kind: 'http-status',
  evaluate(spec, view, step): AssertionResult {
    const response = responseOf(view, step)
    if (!response) {
      return { status: 'skipped', expected: spec.status, diff: `step ${step} produced no HTTP response to assert on` }
    }
    const expected = spec.status
    const actual = response.status
    return actual === expected
      ? { status: 'pass', expected, actual }
      : { status: 'fail', expected, actual, diff: `status: expected ${String(expected)}, got ${String(actual)}` }
  },
}

export const httpJson: AssertionKind = {
  kind: 'http-json',
  evaluate(spec, view, step): AssertionResult {
    const response = responseOf(view, step)
    if (!response) {
      return { status: 'skipped', expected: spec.equals, diff: `step ${step} produced no HTTP response to assert on` }
    }

    const path = readString(spec, 'path', 'body')
    const found = readPath(response, path)
    if (found.missing) {
      return {
        status: 'fail',
        expected: spec.equals ?? spec.contains,
        actual: undefined,
        diff: `${path}: no such field in the response`,
      }
    }

    if (spec.contains !== undefined) {
      const haystack = typeof found.value === 'string' ? found.value : JSON.stringify(found.value)
      const needle = readString(spec, 'contains')
      return haystack.includes(needle)
        ? { status: 'pass', expected: needle, actual: found.value }
        : { status: 'fail', expected: needle, actual: found.value, diff: `${path}: expected to contain ${JSON.stringify(needle)}, got ${JSON.stringify(found.value)}` }
    }

    const expected = spec.equals
    const equal = JSON.stringify(found.value) === JSON.stringify(expected)
    return equal
      ? { status: 'pass', expected, actual: found.value }
      : { status: 'fail', expected, actual: found.value, diff: `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(found.value)}` }
  },
}

/** Dotted path with numeric array indices: `body.items.1.sku`. */
export function readPath(root: unknown, path: string): { value: unknown; missing: boolean } {
  let current: unknown = root
  for (const segment of path.split('.').filter(Boolean)) {
    if (current === null || current === undefined) return { value: undefined, missing: true }
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return { value: undefined, missing: true }
      current = current[index]
      continue
    }
    if (typeof current !== 'object') return { value: undefined, missing: true }
    if (!(segment in (current as Record<string, unknown>))) return { value: undefined, missing: true }
    current = (current as Record<string, unknown>)[segment]
  }
  return { value: current, missing: false }
}

export function assertionKinds(): AssertionKind[] {
  return [httpStatus, httpJson]
}
