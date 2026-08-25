import { describe, expect, it } from 'vitest'
import { classifyLine, gateability, languageOf } from '../../src/classify.js'

const cls = (text: string, path = 'a.ts') => classifyLine(text, languageOf(path)).class

describe('languageOf', () => {
  it('maps extensions to declared languages, and unknown to null', () => {
    expect(languageOf('src/a.ts')).toBe('ts')
    expect(languageOf('src/a.tsx')).toBe('ts')
    expect(languageOf('src/a.mjs')).toBe('ts')
    expect(languageOf('app/main.py')).toBe('py')
    expect(languageOf('cmd/main.go')).toBe('go')
    expect(languageOf('src/Main.java')).toBe('java')
    expect(languageOf('README.md')).toBeNull()
  })
})

describe('classifyLine — excluded (never counted, PRD §7.5)', () => {
  it.each([
    ['', 'blank'],
    ['    ', 'blank'],
    ['// a comment', 'comment'],
    ['/* block */', 'comment'],
    [' * jsdoc continuation', 'comment'],
    ['}', 'bracket'],
    ['  });', 'bracket'],
    ['  ],', 'bracket'],
    [`import { x } from './x.js'`, 'import'],
    [`export * from './y.js'`, 'import'],
    ['type Foo = { a: number }', 'type-only'],
    ['interface Foo {', 'type-only'],
    ['declare module "x"', 'type-only'],
  ])('%j is excluded as %s', (text, reason) => {
    const r = classifyLine(text, 'ts')
    expect(r.class).toBe('excluded')
    expect(r.reason).toBe(reason)
  })

  it('excludes python and go comments and imports', () => {
    expect(cls('# note', 'a.py')).toBe('excluded')
    expect(cls('from x import y', 'a.py')).toBe('excluded')
    expect(cls('import os', 'a.py')).toBe('excluded')
    expect(cls('package main', 'a.go')).toBe('excluded')
    expect(cls('import "fmt"', 'a.go')).toBe('excluded')
    expect(cls('package com.example;', 'A.java')).toBe('excluded')
  })

  it('does not mistake a JS private field for a python comment', () => {
    expect(cls('#count = 0')).toBe('executable')
  })

  it('does not exclude a line that merely contains a comment', () => {
    expect(cls('const a = 1 // set a')).toBe('executable')
  })
})

describe('classifyLine — defensive (policy-governed, PRD §7.5)', () => {
  it.each([
    '} catch (e) {',
    'catch (err) {',
    'throw new Error("bad")',
    'if (!x) throw new Error("x required")',
  ])('%j is defensive in ts', (text) => {
    expect(classifyLine(text, 'ts').class).toBe('defensive')
  })

  it('detects python and go defensive shapes', () => {
    expect(cls('except ValueError:', 'a.py')).toBe('defensive')
    expect(cls('raise ValueError("bad")', 'a.py')).toBe('defensive')
    expect(cls('if err != nil {', 'a.go')).toBe('defensive')
    expect(cls('return nil, err', 'a.go')).toBe('defensive')
    expect(cls('panic("unreachable")', 'a.go')).toBe('defensive')
  })
})

describe('classifyLine — executable (the default)', () => {
  it.each([
    'const bonus = tier * 0.05',
    'return base * (1 - bonus)',
    'if (tier >= 2) {',
    'export function applyTiered(total: number) {',
    'await db.insert(order)',
  ])('%j is executable', (text) => {
    expect(classifyLine(text, 'ts').class).toBe('executable')
  })

  it('classifies an unknown language conservatively as executable', () => {
    expect(classifyLine('some line', null).class).toBe('executable')
  })
})

describe('gateability — the answer to open question Q7', () => {
  it('recognises files that are not code at all', () => {
    expect(gateability('README.md')).toEqual({ kind: 'not-code' })
    expect(gateability('package.json')).toEqual({ kind: 'not-code' })
    expect(gateability('.swe-verify/plans/x.plan.json')).toEqual({ kind: 'not-code' })
    expect(gateability('assets/logo.svg')).toEqual({ kind: 'not-code' })
    expect(gateability('pnpm-lock.yaml')).toEqual({ kind: 'not-code' })
  })

  it('recognises code in a language with a trustworthy DAP adapter', () => {
    expect(gateability('src/a.ts')).toEqual({ kind: 'supported', language: 'ts' })
    expect(gateability('app/main.py')).toEqual({ kind: 'supported', language: 'py' })
  })

  it('recognises code we deliberately refuse to gate, and names the language', () => {
    expect(gateability('app/models.rb')).toEqual({ kind: 'unsupported', language: 'ruby' })
    expect(gateability('src/main.rs')).toEqual({ kind: 'unsupported', language: 'rust' })
    expect(gateability('src/Program.cs')).toEqual({ kind: 'unsupported', language: 'c#' })
  })

  it('classifies lines in an unsupported language well enough to exclude noise', () => {
    expect(classifyLine('# a ruby comment', 'py').class).toBe('excluded')
  })
})

describe('a test assertion failure branch is defensive, not uncovered', () => {
  /**
   * An agent fixed a real library bug, added a table test for it, and was
   * blocked by five SV010s — all `t.Errorf` calls inside `if got != want`
   * branches of its own passing test. A passing test leaves those cold by
   * definition, so the finding asked for something impossible, and both
   * offered remedies (reach the line, or waive it) meant weakening a test
   * that worked. Under the default `warn` policy this now warns instead.
   */
  it('classifies t.Errorf and t.Fatalf as defensive', () => {
    for (const line of ['t.Errorf("got %v, want %v", got, want)', 't.Fatalf("setup failed: %v", err)', 't.Error("mismatch")']) {
      expect(classifyLine(line, 'go').class, line).toBe('defensive')
    }
  })

  it('covers a testing.T bound to another name, which is common in helpers', () => {
    expect(classifyLine('tb.Fatalf("no fixture: %v", err)', 'go').class).toBe('defensive')
  })

  it('still treats ordinary Go statements as executable', () => {
    for (const line of ['total := base * rate', 'return applyTiered(100, 2)', 'x.Errors = nil']) {
      expect(classifyLine(line, 'go').class, line).toBe('executable')
    }
  })

  it('leaves the existing error-handling patterns classified as before', () => {
    expect(classifyLine('if err != nil {', 'go').class).toBe('defensive')
    expect(classifyLine('panic("unreachable")', 'go').class).toBe('defensive')
  })
})
