import { describe, expect, it } from 'vitest'
import { globMatch, matchesScope } from '../../../src/core/glob.js'

describe('globMatch', () => {
  it.each([
    ['src/a.ts', 'src/**', true],
    ['src/deep/nested/a.ts', 'src/**', true],
    ['server/a.ts', 'src/**', false],
    ['a.ts', '**', true],
    ['src/a.ts', '**/*.ts', true],
    ['src/a.test.ts', '**/*.test.*', true],
    ['src/a.ts', 'src/*.ts', true],
    ['src/deep/a.ts', 'src/*.ts', false],
    ['src/a.ts', 'src/?.ts', true],
    ['src/ab.ts', 'src/?.ts', false],
    ['src/migrations/001.sql', '**/migrations/**', true],
  ])('%s vs %s -> %s', (path, pattern, expected) => {
    expect(globMatch(path, pattern)).toBe(expected)
  })

  it('does not let a dot in the pattern match any character', () => {
    expect(globMatch('srcXa.ts', 'src.a.ts')).toBe(false)
  })
})

describe('matchesScope', () => {
  it('excludes win over includes', () => {
    expect(matchesScope('src/a.stories.tsx', { include: ['src/**'], exclude: ['**/*.stories.tsx'] })).toBe(false)
    expect(matchesScope('src/a.tsx', { include: ['src/**'], exclude: ['**/*.stories.tsx'] })).toBe(true)
  })
})
