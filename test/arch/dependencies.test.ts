import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * TDD §6.3: "These four checks are the architecture. Everything else is
 * convention." They are enforced here rather than by review, because a rule
 * that is only in a document is a rule that gets broken during a deadline.
 */

const ROOT = join(import.meta.dirname, '..', '..')
const PACKAGES = join(ROOT, 'packages')

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full)
  }
  return out
}

const IMPORT_RE = /\bfrom\s+['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const out: string[] = []
  for (const m of text.matchAll(IMPORT_RE)) out.push((m[1] ?? m[2] ?? m[3])!)
  return out
}

function packageSources(pkg: string): Array<{ file: string; imports: string[] }> {
  return sourceFiles(join(PACKAGES, pkg, 'src')).map((file) => ({ file: file.slice(ROOT.length + 1), imports: importsOf(file) }))
}

const packages = () =>
  existsSync(PACKAGES) ? readdirSync(PACKAGES).filter((p) => existsSync(join(PACKAGES, p, 'package.json'))) : []

describe('core is pure (NFR-7)', () => {
  const FORBIDDEN = [
    'playwright', '@playwright/test', 'testcontainers',
    '@witness/driver-web', '@witness/driver-api',
    '@witness/probe-dap', '@witness/probe-otel',
    '@witness/recorders', '@witness/vcs', '@witness/cli',
  ]

  it('does not import drivers, probes or recorders — the gate runs with no browser and no debugger', () => {
    for (const { file, imports } of packageSources('core')) {
      for (const imported of imports) {
        expect(FORBIDDEN, `${file} imports ${imported}`).not.toContain(imported)
      }
    }
  })

  it('does not import vcs — core takes a resolved Bypass and returns a GateResult', () => {
    for (const { file, imports } of packageSources('core')) {
      for (const imported of imports) {
        expect(imported, `${file} imports a vcs module`).not.toMatch(/vcs/i)
      }
    }
  })

  it('performs no I/O: no fs, net, http or child_process', () => {
    const IO = /^node:(fs|net|http|https|child_process|dgram|dns|tls|worker_threads|readline)/
    for (const { file, imports } of packageSources('core')) {
      for (const imported of imports) {
        expect(imported, `${file} imports ${imported}`).not.toMatch(IO)
      }
    }
  })
})

describe('the open core is not a demo (NFR-10)', () => {
  it('no packages/* source imports cloud/*', () => {
    for (const pkg of packages()) {
      for (const { file, imports } of packageSources(pkg)) {
        for (const imported of imports) {
          expect(imported, `${file} imports ${imported}`).not.toMatch(/(^|\/)cloud(\/|$)|@witness\/cloud/)
        }
      }
    }
  })

  it('every Apache-2.0 package declares that licence', () => {
    for (const pkg of packages()) {
      const manifest = JSON.parse(readFileSync(join(PACKAGES, pkg, 'package.json'), 'utf8')) as { license?: string }
      expect(manifest.license, `packages/${pkg} has no licence`).toBe('Apache-2.0')
    }
  })
})

describe('redaction lives in core (NFR-5)', () => {
  it('core owns the redaction implementation', () => {
    expect(existsSync(join(PACKAGES, 'core', 'src', 'redact.ts'))).toBe(true)
  })

  it('no other package reimplements it — redaction must happen before disk, in one place', () => {
    for (const pkg of packages()) {
      if (pkg === 'core') continue
      for (const { file } of packageSources(pkg)) {
        expect(file, 'redaction must not be reimplemented outside core').not.toMatch(/redact\.ts$/)
      }
    }
  })
})
