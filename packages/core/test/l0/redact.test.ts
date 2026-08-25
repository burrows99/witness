import { describe, expect, it } from 'vitest'
import { REDACTED, compileRedactionPolicy, redact, redactStory } from '../../src/redact.js'
import { DEFAULT_CONFIG } from '../../src/schema.js'
import { minimalStory } from '../helpers/fixtures.js'

const policy = compileRedactionPolicy(DEFAULT_CONFIG.redact)

describe('redact — key based', () => {
  it('redacts a value whose key is a declared secret key', () => {
    expect(redact({ password: 'hunter2', user: 'ada' }, policy)).toEqual({ password: REDACTED, user: 'ada' })
  })

  it('matches keys case- and separator-insensitively', () => {
    const out = redact({ 'X-Api-Key': 'k', Authorization: 'Bearer x', SSN: '1' }, policy) as Record<string, unknown>
    expect(out['X-Api-Key']).toBe(REDACTED)
    expect(out.Authorization).toBe(REDACTED)
    expect(out.SSN).toBe(REDACTED)
  })

  it('redacts through nesting and arrays', () => {
    const out = redact({ a: [{ token: 't' }, { ok: 1 }], b: { c: { secret: 's' } } }, policy)
    expect(out).toEqual({ a: [{ token: REDACTED }, { ok: 1 }], b: { c: { secret: REDACTED } } })
  })

  it('redacts the whole subtree under a secret key, not just a string', () => {
    expect(redact({ token: { value: 'x', exp: 1 } }, policy)).toEqual({ token: REDACTED })
  })
})

describe('redact — pattern based', () => {
  it('applies a (?i) inline flag as a JS case-insensitive regex', () => {
    expect(redact({ h: 'Bearer AbC-123._x' }, policy)).toEqual({ h: REDACTED })
  })

  it('redacts only the matching span inside a longer string', () => {
    const out = redact({ log: 'sent with Bearer abc123 to /v1' }, policy) as Record<string, string>
    expect(out.log).toBe(`sent with ${REDACTED} to /v1`)
  })

  it('ignores an invalid user pattern instead of crashing the run', () => {
    const p = compileRedactionPolicy({ ...DEFAULT_CONFIG.redact, patterns: ['([unclosed'] })
    expect(() => redact({ a: 'b' }, p)).not.toThrow()
  })
})

describe('redact — structure and safety', () => {
  it('leaves innocent data untouched, preserving types', () => {
    const input = { n: 1, b: true, nul: null, s: 'plain', arr: [1, 2] }
    expect(redact(input, policy)).toEqual(input)
  })

  it('drops binary values when onUnknownBinary is drop', () => {
    expect(redact({ blob: new Uint8Array([1, 2, 3]) }, policy)).toEqual({ blob: REDACTED })
  })

  it('survives a cyclic object without hanging', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    expect(() => redact(a, policy)).not.toThrow()
  })

  it('does not mutate its input', () => {
    const input = { password: 'hunter2' }
    redact(input, policy)
    expect(input.password).toBe('hunter2')
  })
})

describe('redactStory — every field that can carry captured state', () => {
  it('redacts logpoint vars, span attrs, step args and assertion values', () => {
    const story = minimalStory()
    story.events = [
      { seq: 1, tier: 'server', trace_id: 't', wall: 'w', mono_ns: 1, type: 'logpoint', probe_id: 'p1', file: 'a.ts', line: 1, vars: { password: 'hunter2', total: 42 }, hit: 1 },
      { seq: 2, tier: 'data', trace_id: 't', wall: 'w', mono_ns: 2, type: 'span', name: 'db', kind: 'client', attrs: { 'db.statement': 'select 1', token: 'x' }, duration_ms: 3 },
      { seq: 3, tier: 'browser', trace_id: 't', wall: 'w', mono_ns: 3, type: 'step', driver: 'web', action: 'fill', args: { password: 'hunter2' }, status: 'ok' },
    ]
    story.assertions = [{ id: 'a1', status: 'fail', expected: { token: 'a' }, actual: { token: 'b' } }]

    const out = redactStory(story, policy)
    const lp = out.events[0] as { vars: Record<string, unknown> }
    expect(lp.vars).toEqual({ password: REDACTED, total: 42 })
    expect((out.events[1] as { attrs: Record<string, unknown> }).attrs['token']).toBe(REDACTED)
    expect((out.events[2] as { args: Record<string, unknown> }).args['password']).toBe(REDACTED)
    expect(out.assertions[0]!.actual).toEqual({ token: REDACTED })
  })

  it('leaves the diff, coverage and seal fields alone', () => {
    const story = minimalStory()
    const out = redactStory(story, policy)
    expect(out.diff).toEqual(story.diff)
    expect(out.coverage).toEqual(story.coverage)
  })
})
