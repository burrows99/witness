import { randomBytes } from 'node:crypto'

/**
 * W3C Trace Context.
 *
 * One `traceparent` threads browser → server → data. The agent never
 * correlates by timestamp; the harness does it at capture time, and that
 * single choice is what turns three log files into one readable artefact.
 */

const ZERO_TRACE = '0'.repeat(32)
const ZERO_SPAN = '0'.repeat(16)

export function newTraceId(): string {
  let id = randomBytes(16).toString('hex')
  // The all-zero id is invalid per the spec; regenerating is cheaper than
  // explaining why one run in 2^128 has no trace.
  while (id === ZERO_TRACE) id = randomBytes(16).toString('hex')
  return id
}

export function newSpanId(): string {
  let id = randomBytes(8).toString('hex')
  while (id === ZERO_SPAN) id = randomBytes(8).toString('hex')
  return id
}

export function traceparent(traceId: string, spanId: string, sampled = true): string {
  return `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`
}

export interface TraceContext {
  traceId: string
  spanId: string
  sampled: boolean
}

const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/

export function parseTraceparent(header: string): TraceContext | null {
  const match = TRACEPARENT.exec(header.trim())
  if (!match) return null
  const [, , traceId, spanId, flags] = match
  if (traceId === ZERO_TRACE || spanId === ZERO_SPAN) return null
  return { traceId: traceId!, spanId: spanId!, sampled: (Number.parseInt(flags!, 16) & 1) === 1 }
}
