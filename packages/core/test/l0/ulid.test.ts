import { describe, expect, it } from 'vitest'
import { ulid, isUlid, ulidTime } from '../../src/ulid.js'

/**
 * The run id is a client-generated ULID: idempotency on upload (a retried CI
 * job is a no-op, not a duplicate) and lexicographic time ordering, which is
 * what makes "the most recent run" a sort rather than a query.
 */
describe('ulid', () => {
  it('is 26 characters of Crockford base32', () => {
    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('never contains the ambiguous letters I, L, O or U', () => {
    const many = Array.from({ length: 200 }, () => ulid()).join('')
    expect(many).not.toMatch(/[ILOU]/)
  })

  it('is unique across rapid calls', () => {
    expect(new Set(Array.from({ length: 1000 }, () => ulid())).size).toBe(1000)
  })

  it('sorts lexicographically by time', () => {
    const early = ulid(new Date('2026-01-01T00:00:00Z'))
    const late = ulid(new Date('2026-08-24T00:00:00Z'))
    expect([late, early].sort()).toEqual([early, late])
  })

  it('round-trips its timestamp', () => {
    const when = new Date('2026-08-24T10:11:02.401Z')
    expect(ulidTime(ulid(when))?.getTime()).toBe(when.getTime())
  })

  it('validates the ids the story schema accepts, and rejects others', () => {
    expect(isUlid(ulid())).toBe(true)
    expect(isUlid('01JB7QK3M9X2VYD8N4T6')).toBe(false)
    expect(isUlid('01JB7QK3M9X2VYD8N4T6ZQWERI')).toBe(false)
  })
})
