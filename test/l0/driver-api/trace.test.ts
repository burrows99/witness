import { describe, expect, it } from 'vitest'
import { newTraceId, newSpanId, traceparent, parseTraceparent } from '../../../src/driver-api/trace.js'

/**
 * W3C Trace Context is what turns three log files into one story: the same
 * id threads browser → server → data, so the harness correlates at capture
 * time and the agent never correlates by timestamp (TDD §7.8).
 */
describe('trace ids', () => {
  it('mints a 32-hex trace id', () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('mints a 16-hex span id', () => {
    expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/)
  })

  it('never mints the all-zero id, which is invalid per the spec', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(newTraceId()).not.toBe('0'.repeat(32))
      expect(newSpanId()).not.toBe('0'.repeat(16))
    }
  })

  it('is unique across calls', () => {
    expect(new Set(Array.from({ length: 100 }, newTraceId)).size).toBe(100)
  })
})

describe('traceparent header', () => {
  it('formats version-traceid-spanid-flags with the sampled flag set', () => {
    const header = traceparent('a'.repeat(32), 'b'.repeat(16))
    expect(header).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`)
  })

  it('round-trips through the parser', () => {
    const traceId = newTraceId()
    const spanId = newSpanId()
    expect(parseTraceparent(traceparent(traceId, spanId))).toEqual({ traceId, spanId, sampled: true })
  })

  it('rejects a malformed header rather than inventing a trace', () => {
    expect(parseTraceparent('nonsense')).toBeNull()
    expect(parseTraceparent(`00-${'a'.repeat(31)}-${'b'.repeat(16)}-01`)).toBeNull()
    expect(parseTraceparent(`00-${'0'.repeat(32)}-${'b'.repeat(16)}-01`)).toBeNull()
  })

  it('accepts a future version, as the spec requires', () => {
    expect(parseTraceparent(`01-${'a'.repeat(32)}-${'b'.repeat(16)}-01-extra`)?.traceId).toBe('a'.repeat(32))
  })
})
