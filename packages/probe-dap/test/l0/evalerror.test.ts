import { describe, expect, it } from 'vitest'
import { parseEvaluationError } from '../../src/evalerror.js'

/**
 * An adapter that cannot evaluate an interpolated expression prints its own
 * error *instead of* the log message. The probe then looks like it never
 * fired — but the error is proof that it did: the message is only evaluated
 * when the breakpoint is hit.
 */
describe('parseEvaluationError', () => {
  it('recognises the Python form and names the symbol', () => {
    expect(parseEvaluationError("name 'base' is not defined\n")).toEqual({ symbol: 'base', detail: "name 'base' is not defined" })
  })

  it('recognises the Go form', () => {
    expect(parseEvaluationError('could not find symbol value for total')).toEqual({ symbol: 'total', detail: 'could not find symbol value for total' })
  })

  it('recognises the Java form', () => {
    expect(parseEvaluationError('Cannot evaluate expression: cartTotal cannot be resolved to a variable')?.symbol).toBe('cartTotal')
  })

  it('recognises the JavaScript form', () => {
    expect(parseEvaluationError('ReferenceError: bonus is not defined')).toEqual({ symbol: 'bonus', detail: 'ReferenceError: bonus is not defined' })
  })

  it('returns null for ordinary application output', () => {
    expect(parseEvaluationError('listening on 3000')).toBeNull()
    expect(parseEvaluationError('')).toBeNull()
  })
})
