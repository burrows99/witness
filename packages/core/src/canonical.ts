import { createHash } from 'node:crypto'

/**
 * RFC 8785 (JCS) style canonical JSON: object keys sorted, no insignificant
 * whitespace. Used for `diff_hash` and for the story seal, both of which must
 * be recomputable by a party that did not produce the artefact (TDD §7.1).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value))
}

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key]
      if (v === undefined) continue
      out[key] = canonicalise(v)
    }
    return out
  }
  return value
}

export function sha256(input: string): string {
  return `sha256:${createHash('sha256').update(input, 'utf8').digest('hex')}`
}

export function sha256Bytes(input: Uint8Array): string {
  return `sha256:${createHash('sha256').update(input).digest('hex')}`
}
