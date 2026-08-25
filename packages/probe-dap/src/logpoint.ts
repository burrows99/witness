import type { ProbeTarget } from '@macquery-labs/core'

/**
 * Logpoint encoding.
 *
 * DAP is explicit that when `logMessage` is set the adapter must log rather
 * than break, and interpolates `{expression}` in the message. That is exactly
 * "observe state at a line without stopping the process" — and the reason
 * breakpoints could never have been the default: a suspended server cannot
 * serve the request you are trying to observe (TDD §7.3).
 *
 * The encoding uses an ASCII unit separator rather than nested JSON because
 * the message is assembled by the *adapter*, from values it formats itself: a
 * value containing a quote or a brace would break any JSON-in-JSON scheme.
 */

export const LOGPOINT_MAGIC = 'WTNS1'

/** ASCII unit separator (0x1f): never emitted by a value, always safe to split on. */
export const FIELD_SEPARATOR = ''

/** Only a bare identifier is ever interpolated: evaluating a call could have effects. */
const SAFE_EXPRESSION = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export function buildLogMessage(target: ProbeTarget): string {
  const parts = [LOGPOINT_MAGIC, target.id]
  for (const expression of target.expressions) {
    if (!SAFE_EXPRESSION.test(expression)) continue
    parts.push(expression, `{${expression}}`)
  }
  return parts.join(FIELD_SEPARATOR)
}

export interface LogpointHit {
  probeId: string
  vars: Record<string, unknown>
}

export interface ParseOptions {
  all?: boolean
}

export function parseLogOutput(output: string): LogpointHit | null
export function parseLogOutput(output: string, options: { all: true }): LogpointHit[]
export function parseLogOutput(output: string, options: ParseOptions = {}): LogpointHit | LogpointHit[] | null {
  const hits: LogpointHit[] = []
  const marker = `${LOGPOINT_MAGIC}${FIELD_SEPARATOR}`
  for (const line of output.split('\n')) {
    const start = line.indexOf(marker)
    if (start < 0) continue
    const parts = line.slice(start).split(FIELD_SEPARATOR)
    const probeId = parts[1]
    if (!probeId) continue
    const vars: Record<string, unknown> = {}
    for (let i = 2; i + 1 < parts.length; i += 2) {
      vars[parts[i]!] = coerce(parts[i + 1]!)
    }
    hits.push({ probeId, vars })
    if (!options.all) return hits[0]!
  }
  return options.all ? hits : null
}

/**
 * Adapters format values as text. Numbers, booleans and null are coerced so a
 * story carries typed data; everything else stays the adapter's own
 * representation, including its error strings — an expression the adapter
 * could not evaluate must not look like a value it could.
 */
function coerce(raw: string): unknown {
  const text = raw.trim()
  if (text === '') return ''
  if (text === 'true' || text === 'True') return true
  if (text === 'false' || text === 'False') return false
  if (text === 'null' || text === 'None' || text === 'nil') return null
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
  return raw
}
