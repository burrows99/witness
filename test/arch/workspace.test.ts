import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The package is one package.
 *
 * It was nine, published as nine, which is nine things a reader has to install
 * and keep in step for one tool. Collapsing them removed the machinery that
 * used to hold the shape — no manifest per module, no catalog, no version
 * drift to police — and left the shape itself needing to be asserted instead.
 */

const ROOT = join(import.meta.dirname, '..', '..')
const SPECIFIER = /\bfrom\s+['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
const SRC = join(ROOT, 'src')

const manifest = () =>
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, unknown>

const modules = () =>
  readdirSync(SRC).filter((entry) => statSync(join(SRC, entry)).isDirectory())

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full)
  }
  return out
}

describe('one package, not nine', () => {
  it('leaves nothing of the workspace behind', () => {
    // Dead configuration is worse than none: it describes a layout that no
    // longer exists and sends the next reader looking for it.
    for (const stale of ['pnpm-workspace.yaml', 'packages', 'tsconfig.base.json']) {
      expect(existsSync(join(ROOT, stale)), `${stale} still exists`).toBe(false)
    }
  })

  it('publishes under one name, with the binary the CLI answers to', () => {
    const m = manifest()
    expect(m.name).toBe('@macquery-labs/witness')
    expect(JSON.stringify(m.bin)).toContain('dist/')
  })

  it('is publishable — the root is no longer private', () => {
    // It had to be private while it was a workspace root. Left in place, it
    // would silently refuse every publish.
    expect(manifest().private).toBeUndefined()
  })

  it('ships only what it builds', () => {
    expect(manifest().files).toEqual(expect.arrayContaining(['dist']))
    expect(manifest().files).not.toContain('src')
  })

  it('declares no dependency on itself', () => {
    // The modules import each other by relative path now; a leftover
    // self-dependency would install a published copy alongside the source.
    const deps = { ...(manifest().dependencies ?? {}), ...(manifest().devDependencies ?? {}) }
    expect(Object.keys(deps)).not.toContain('@macquery-labs/witness')
  })
})

describe('the modules keep their boundaries without npm to enforce them', () => {
  it('gives every module one door', () => {
    for (const module of modules()) {
      expect(existsSync(join(SRC, module, 'index.ts')), `src/${module} has no index.ts`).toBe(true)
    }
  })

  it('has no module importing another by package name', () => {
    // `@macquery-labs/core` resolves to nothing now. If one survived a rename
    // it would fail at runtime rather than at build, in whichever command
    // happened to reach it first.
    for (const file of sourceFiles(SRC)) {
      // Import specifiers only. Prose may mention the published name; an
      // import cannot, because nothing resolves it.
      for (const m of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
        const specifier = (m[1] ?? m[2] ?? m[3])!
        expect(specifier, `${file.slice(ROOT.length + 1)} imports by package name`).not.toMatch(/^@macquery-labs\//)
      }
    }
  })

  it('declares @types/node, since the source reaches for node builtins', () => {
    const dev = (manifest().devDependencies ?? {}) as Record<string, string>
    expect(Object.keys(dev)).toContain('@types/node')
  })
})
