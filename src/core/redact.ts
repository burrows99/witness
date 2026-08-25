import type { Story, StoryEvent } from './types.js'

/**
 * Redaction — NFR-5.
 *
 * This runs *before an artefact is written to disk*, not before it is
 * uploaded. A leaked token in a CI artifact has already leaked, so redaction
 * has to live in `core` where the free CLI uses it; putting it in `cloud/`
 * would mean the free tier writes secrets to CI artifacts, a worse exposure
 * than the vault ever was.
 */

export const REDACTED = '[redacted]'

export interface RedactionPolicyInput {
  keys: string[]
  patterns: string[]
  onUnknownBinary: 'drop' | 'keep'
}

export interface RedactionPolicy {
  keys: string[]
  patterns: RegExp[]
  onUnknownBinary: 'drop' | 'keep'
  /** Patterns that failed to compile — surfaced by `doctor`, never fatal. */
  invalidPatterns: string[]
}

/** `x-api-key`, `X_API_KEY` and `apiKey` all normalise to `xapikey`/`apikey`. */
function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Accepts the inline `(?i)` flag used in the config examples; JavaScript has
 * no inline flags, so it is lifted to a real regex flag.
 */
export function compileRedactionPolicy(input: RedactionPolicyInput): RedactionPolicy {
  const patterns: RegExp[] = []
  const invalidPatterns: string[] = []
  for (const raw of input.patterns) {
    try {
      let source = raw
      let flags = 'g'
      const inline = /^\(\?([ims]+)\)/.exec(source)
      if (inline) {
        source = source.slice(inline[0].length)
        flags += inline[1]!
      }
      patterns.push(new RegExp(source, flags))
    } catch {
      // A bad pattern in config must not take down a verification run; it is
      // reported by `doctor` rather than thrown here.
      invalidPatterns.push(raw)
    }
  }
  return {
    keys: input.keys.map(normaliseKey).filter(Boolean),
    patterns,
    onUnknownBinary: input.onUnknownBinary,
    invalidPatterns,
  }
}

function isSecretKey(key: string, policy: RedactionPolicy): boolean {
  const n = normaliseKey(key)
  return policy.keys.some((k) => n.includes(k))
}

function redactString(value: string, policy: RedactionPolicy): string {
  let out = value
  for (const pattern of policy.patterns) {
    pattern.lastIndex = 0
    out = out.replace(pattern, REDACTED)
  }
  return out
}

/**
 * Deep-copy `value`, replacing anything that matches the policy. Pure: the
 * input is never mutated, because the caller may still need the raw value
 * in memory (to evaluate an assertion, say) after the artefact is written.
 */
export function redact<T>(value: T, policy: RedactionPolicy): T {
  return walk(value, policy, new WeakSet<object>()) as T
}

function walk(value: unknown, policy: RedactionPolicy, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return redactString(value, policy)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function' || typeof value === 'symbol') return REDACTED

  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return policy.onUnknownBinary === 'drop' ? REDACTED : value
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[cycle]'
    seen.add(value)
    try {
      if (Array.isArray(value)) return value.map((v) => walk(v, policy, seen))
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        // A secret key redacts its whole subtree: `{"token": {...}}` must not
        // leak through a nested field.
        out[k] = isSecretKey(k, policy) ? REDACTED : walk(v, policy, seen)
      }
      return out
    } finally {
      seen.delete(value)
    }
  }
  return REDACTED
}

/**
 * Apply the policy to every part of a story that can carry captured state:
 * logpoint variables, span attributes, driver step arguments and assertion
 * values. Structural fields (diff, coverage, seal) are left alone — they are
 * hashes and counts, and redacting them would break verification.
 */
export function redactStory(story: Story, policy: RedactionPolicy): Story {
  const events: StoryEvent[] = story.events.map((event) => {
    switch (event.type) {
      case 'logpoint':
        return { ...event, vars: redact(event.vars, policy) }
      case 'span':
        return { ...event, attrs: redact(event.attrs, policy) }
      case 'step':
        return { ...event, args: redact(event.args, policy) }
      case 'diagnostic':
        return { ...event, message: redact(event.message, policy) }
      default:
        return event
    }
  })

  return {
    ...story,
    events,
    assertions: story.assertions.map((a) => ({
      ...a,
      ...(a.expected !== undefined ? { expected: redact(a.expected, policy) } : {}),
      ...(a.actual !== undefined ? { actual: redact(a.actual, policy) } : {}),
      ...(a.diff !== undefined ? { diff: redact(a.diff, policy) } : {}),
    })),
    diagnostics: story.diagnostics.map((d) => ({ ...d, message: redact(d.message, policy) })),
  }
}
