import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * TDD §6.3: "These four checks are the architecture. Everything else is
 * convention." They are enforced here rather than by review, because a rule
 * that is only in a document is a rule that gets broken during a deadline.
 */

const ROOT = join(import.meta.dirname, '..', '..')
const SRC = join(ROOT, 'src')

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

/**
 * One package now, so these boundaries are directory rules rather than
 * dependency rules. That makes them easier to break by accident — nothing in
 * npm stops `src/core` importing `src/driver-web` any more — and therefore
 * more important to assert here.
 */
function packageSources(pkg: string): Array<{ file: string; imports: string[] }> {
  return sourceFiles(join(SRC, pkg)).map((file) => ({ file: file.slice(ROOT.length + 1), imports: importsOf(file) }))
}

const packages = () =>
  existsSync(SRC) ? readdirSync(SRC).filter((p) => existsSync(join(SRC, p, 'index.ts'))) : []

describe('core is pure (NFR-7)', () => {
  const FORBIDDEN_PACKAGES = ['playwright', '@playwright/test', 'testcontainers']
  const FORBIDDEN_MODULES = ['driver-web', 'driver-api', 'probe-dap', 'recorders', 'vcs', 'cli', 'mcp']
  const reaches = (specifier: string, module: string) =>
    new RegExp(`(^|/)\\.\\./${module}(/|$)`).test(specifier)
  const FORBIDDEN = FORBIDDEN_PACKAGES

  it('does not import drivers, probes or recorders — the gate runs with no browser and no debugger', () => {
    for (const { file, imports } of packageSources('core')) {
      for (const imported of imports) {
        expect(FORBIDDEN, `${file} imports ${imported}`).not.toContain(imported)
        for (const module of FORBIDDEN_MODULES) {
          expect(reaches(imported, module), `${file} imports ${imported}`).toBe(false)
        }
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

  it('declares its licence, and publishes to the right registry', () => {
    // One manifest now. A missing publishConfig is how a scoped package
    // silently goes to npmjs.org instead of the registry that owns the scope.
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      license?: string
      publishConfig?: { registry?: string }
    }
    expect(manifest.license).toBe('Apache-2.0')
    expect(manifest.publishConfig?.registry).toBe('https://npm.pkg.github.com')
  })

  it('every module is reachable through an index', () => {
    // The directory boundaries only mean something if each module has one door.
    for (const pkg of packages()) {
      expect(existsSync(join(SRC, pkg, 'index.ts')), `src/${pkg} has no index.ts`).toBe(true)
    }
    expect(packages().length).toBeGreaterThan(1)
  })
})

describe('redaction lives in core (NFR-5)', () => {
  it('core owns the redaction implementation', () => {
    expect(existsSync(join(SRC, 'core', 'redact.ts'))).toBe(true)
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
