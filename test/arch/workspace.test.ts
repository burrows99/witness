import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Workspace hygiene, enforced rather than reviewed.
 *
 * A monorepo has one manifest per package by design — that is what makes each
 * one independently useful and independently forkable (TDD §6.1). What rots is
 * not the number of manifests but their consistency: a version that drifts in
 * one package, an internal dependency that silently resolves from the registry
 * instead of the workspace, a scaffolded directory nobody filled in.
 */

const ROOT = join(import.meta.dirname, '..', '..')
const PACKAGES = join(ROOT, 'packages')

interface Manifest {
  name?: string
  version?: string
  description?: string
  license?: string
  type?: string
  main?: string
  types?: string
  exports?: unknown
  files?: string[]
  engines?: Record<string, string>
  publishConfig?: { access?: string }
  workspaces?: unknown
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Manifest
const workspaceYaml = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8')

const packageDirs = readdirSync(PACKAGES).filter((entry) => statSync(join(PACKAGES, entry)).isDirectory())
const manifests = new Map<string, Manifest>(
  packageDirs
    .filter((dir) => existsSync(join(PACKAGES, dir, 'package.json')))
    .map((dir) => [dir, JSON.parse(readFileSync(join(PACKAGES, dir, 'package.json'), 'utf8')) as Manifest]),
)

/** Names in the `catalog:` block of pnpm-workspace.yaml. */
const catalogued = new Set(
  [...workspaceYaml.matchAll(/^ {2}'?([@\w./-]+)'?:\s*\S+$/gm)]
    .map((match) => match[1]!)
    .filter((name) => name !== 'packages'),
)

describe('the workspace is defined in one place', () => {
  it('declares its packages in pnpm-workspace.yaml', () => {
    expect(workspaceYaml).toMatch(/^packages:/m)
    expect(workspaceYaml).toMatch(/packages\/\*/)
  })

  it('has no "workspaces" field in any manifest — pnpm ignores it, so it would be dead config', () => {
    expect(root.workspaces).toBeUndefined()
    for (const [dir, manifest] of manifests) expect(manifest.workspaces, dir).toBeUndefined()
  })

  it('globs only directories that actually contain a package', () => {
    const globbed = [...workspaceYaml.matchAll(/^ {2}- (.+)$/gm)].map((m) => m[1]!.trim())
    for (const glob of globbed) {
      const dir = join(ROOT, glob.replace(/\/\*$/, ''))
      expect(existsSync(dir), `${glob} matches nothing`).toBe(true)
      const children = readdirSync(dir).filter((entry) => statSync(join(dir, entry)).isDirectory())
      expect(children.length, `${glob} matches no package`).toBeGreaterThan(0)
    }
  })

  it('has no half-scaffolded package directory', () => {
    for (const dir of packageDirs) {
      expect(existsSync(join(PACKAGES, dir, 'package.json')), `packages/${dir} has no package.json`).toBe(true)
      expect(existsSync(join(PACKAGES, dir, 'src')), `packages/${dir} has no src`).toBe(true)
    }
  })

  it('keeps the root private, so it can never be published by accident', () => {
    expect((root as { private?: boolean }).private).toBe(true)
  })
})

describe('every package manifest has the same shape', () => {
  it.each([...manifests.keys()])('packages/%s declares what a consumer needs', (dir) => {
    const manifest = manifests.get(dir)!
    expect(manifest.name).toBe(`@swe-verify/${dir}`)
    expect(manifest.version).toBe(root.version)
    expect(manifest.description?.length ?? 0).toBeGreaterThan(20)
    expect(manifest.license).toBe('Apache-2.0')
    expect(manifest.type).toBe('module')
    expect(manifest.exports).toBeDefined()
    expect(manifest.files).toEqual(['dist'])
    expect(manifest.engines?.node).toBe(root.engines?.node)
    // Scoped packages are restricted on npm unless this says otherwise.
    expect(manifest.publishConfig?.access).toBe('public')
  })

  it('every package builds to dist, and ships only dist', () => {
    for (const [dir, manifest] of manifests) {
      expect(manifest.main, dir).toMatch(/^\.\/dist\//)
      expect(manifest.types, dir).toMatch(/^\.\/dist\//)
    }
  })

  it('declares @types/node wherever the source imports a node builtin', () => {
    for (const [dir, manifest] of manifests) {
      const usesNode = sourceFiles(join(PACKAGES, dir, 'src')).some((file) => /from '(node:|node:)/.test(readFileSync(file, 'utf8')))
      if (!usesNode) continue
      expect(manifest.devDependencies?.['@types/node'], `packages/${dir} imports node builtins`).toBeDefined()
    }
  })
})

describe('dependencies cannot drift', () => {
  it('references sibling packages with the workspace protocol, never a version range', () => {
    for (const [dir, manifest] of manifests) {
      for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
        if (!name.startsWith('@swe-verify/')) continue
        // A plain range here would resolve from the registry the day someone
        // publishes that name, and nobody would notice.
        expect(range, `packages/${dir} → ${name}`).toMatch(/^workspace:/)
      }
    }
  })

  it('takes every catalogued external version from the catalog', () => {
    for (const [dir, manifest] of manifests) {
      for (const field of ['dependencies', 'devDependencies'] as const) {
        for (const [name, range] of Object.entries(manifest[field] ?? {})) {
          if (!catalogued.has(name)) continue
          expect(range, `packages/${dir} → ${name} in ${field}`).toBe('catalog:')
        }
      }
    }
  })

  it('takes the root toolchain from the catalog too', () => {
    for (const [name, range] of Object.entries(root.devDependencies ?? {})) {
      expect(range, `root → ${name}`).toBe('catalog:')
    }
  })

  it('pins no version twice — the catalog is the single source', () => {
    const seen = new Map<string, string>()
    for (const [dir, manifest] of manifests) {
      for (const field of ['dependencies', 'devDependencies'] as const) {
        for (const [name, range] of Object.entries(manifest[field] ?? {})) {
          if (range.startsWith('workspace:') || range === 'catalog:') continue
          const previous = seen.get(name)
          expect(previous === undefined || previous === range, `${name} is ${previous} elsewhere and ${range} in packages/${dir}`).toBe(true)
          seen.set(name, range)
        }
      }
    }
  })

  it('declares an optional dependency as a peer, so a consumer chooses it', () => {
    const web = manifests.get('driver-web')!
    expect(web.peerDependencies?.playwright).toBeDefined()
    // …and as a dev dependency, so it resolves inside the workspace rather
    // than by accident from a hoisted root copy.
    expect(web.devDependencies?.playwright).toBe('catalog:')
  })
})

describe('the build graph matches the dependency graph', () => {
  it('every workspace dependency is also a TypeScript project reference', () => {
    for (const [dir, manifest] of manifests) {
      const tsconfigPath = join(PACKAGES, dir, 'tsconfig.json')
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as { references?: Array<{ path: string }> }
      const referenced = new Set((tsconfig.references ?? []).map((r) => r.path.replace('../', '')))
      for (const name of Object.keys(manifest.dependencies ?? {})) {
        if (!name.startsWith('@swe-verify/')) continue
        const sibling = name.slice('@swe-verify/'.length)
        // Without the reference, `tsc --build` compiles against a stale dist.
        expect(referenced.has(sibling), `packages/${dir}/tsconfig.json is missing a reference to ${sibling}`).toBe(true)
      }
    }
  })

  it('the root project references every package, so one build covers the repo', () => {
    const tsconfig = JSON.parse(readFileSync(join(ROOT, 'tsconfig.json'), 'utf8')) as { references?: Array<{ path: string }> }
    const referenced = new Set((tsconfig.references ?? []).map((r) => r.path))
    for (const dir of manifests.keys()) expect(referenced.has(`packages/${dir}`), dir).toBe(true)
  })
})

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}
