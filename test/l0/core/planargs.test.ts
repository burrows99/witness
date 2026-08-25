import { describe, expect, it } from 'vitest'
import { readString, readNumber, readBoolean } from '../../../src/core/planargs.js'

/**
 * A plan is committed JSON that a human or an agent wrote by hand. Coercing
 * whatever it contains with `String(...)` turns a mistake — an object where a
 * string belongs — into a step that types "[object Object]" into a form and
 * carries on. The gate would then report the flow as exercised.
 */
describe('readString', () => {
  it('reads a string argument', () => {
    expect(readString({ path: '/cart' }, 'path')).toBe('/cart')
  })

  it('accepts a number or boolean, which JSON authors write for query values', () => {
    expect(readString({ page: 2 }, 'page')).toBe('2')
    expect(readString({ debug: true }, 'debug')).toBe('true')
  })

  it('falls back when the argument is absent', () => {
    expect(readString({}, 'path', '/')).toBe('/')
  })

  it('refuses an object rather than stringifying it to nonsense', () => {
    expect(() => readString({ value: { a: 1 } }, 'value')).toThrow(/"value".*object/i)
  })

  it('refuses an array, and names the argument so the plan can be fixed', () => {
    expect(() => readString({ name: ['a', 'b'] }, 'name')).toThrow(/"name"/)
  })

  it('refuses null, which is not the same as absent', () => {
    expect(() => readString({ path: null }, 'path', '/')).toThrow(/"path"/)
  })

  it('reports a missing required argument by name', () => {
    expect(() => readString({}, 'path')).toThrow(/"path" is required/)
  })
})

describe('readNumber', () => {
  it('reads a number, and a numeric string', () => {
    expect(readNumber({ timeoutMs: 500 }, 'timeoutMs')).toBe(500)
    expect(readNumber({ timeoutMs: '500' }, 'timeoutMs')).toBe(500)
  })

  it('falls back when absent', () => {
    expect(readNumber({}, 'timeoutMs', 10_000)).toBe(10_000)
  })

  it('refuses something that is not a number', () => {
    expect(() => readNumber({ timeoutMs: 'soon' }, 'timeoutMs')).toThrow(/"timeoutMs"/)
    expect(() => readNumber({ timeoutMs: Number.NaN }, 'timeoutMs')).toThrow(/"timeoutMs"/)
  })
})

describe('readBoolean', () => {
  it('reads a boolean and falls back when absent', () => {
    expect(readBoolean({ headless: false }, 'headless', true)).toBe(false)
    expect(readBoolean({}, 'headless', true)).toBe(true)
  })

  it('refuses a non-boolean rather than guessing what it meant', () => {
    expect(() => readBoolean({ headless: 'yes' }, 'headless', true)).toThrow(/"headless"/)
  })
})
