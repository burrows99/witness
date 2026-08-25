import { describe, expect, it } from 'vitest'
import { sealStory, verifySeal } from '../../src/seal.js'
import { canonicalJson, sha256 } from '../../src/canonical.js'
import { minimalStory } from '../helpers/fixtures.js'

describe('canonicalJson', () => {
  it('sorts object keys at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
  })
  it('preserves array order — arrays are data, not sets', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
  })
  it('drops undefined members rather than emitting null', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}')
  })
})

describe('sealStory / verifySeal', () => {
  it('seals over the story minus the seal itself', () => {
    const sealed = sealStory(minimalStory())
    expect(sealed.seal).toBeDefined()
    expect(sealed.seal!.over).toBe('jcs(story minus seal)')
    const { seal: _seal, ...rest } = sealed
    expect(sealed.seal!.value).toBe(sha256(canonicalJson(rest)))
  })

  it('verifies a story it sealed', () => {
    expect(verifySeal(sealStory(minimalStory()))).toBe(true)
  })

  it('is independent of key insertion order — a third party can recompute it', () => {
    const a = sealStory(minimalStory())
    const reordered = JSON.parse(JSON.stringify({ coverage: a.coverage, ...a }))
    expect(verifySeal(reordered)).toBe(true)
  })

  it('fails when any field is tampered with after sealing', () => {
    const sealed = sealStory(minimalStory())
    sealed.coverage.summary.fired = 99
    expect(verifySeal(sealed)).toBe(false)
  })

  it('fails when a coverage line is added after sealing', () => {
    const sealed = sealStory(minimalStory())
    sealed.coverage.lines.push({ file: 'a.ts', line: 1, class: 'executable', verified: true, hits: 1 })
    expect(verifySeal(sealed)).toBe(false)
  })

  it('reports false for an unsealed story rather than throwing', () => {
    expect(verifySeal(minimalStory())).toBe(false)
  })

  it('is stable across repeated sealing of the same content', () => {
    expect(sealStory(minimalStory()).seal!.value).toBe(sealStory(minimalStory()).seal!.value)
  })
})
