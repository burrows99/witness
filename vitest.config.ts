import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Test tiers — TDD §12. The pyramid is inverted on purpose: the risk is not
 * "is the logic correct" but "does this work on real, messy code", so the
 * expensive tiers carry the weight and are selected explicitly.
 *
 * Tests resolve workspace packages to sources, never a built dist/. The same
 * mapping exists in tsconfig.eslint.json so that type-checking and linting see
 * exactly what the tests run.
 */
const pkg = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))

const alias = {
  '@macquery-labs/core': pkg('core'),
  '@macquery-labs/vcs': pkg('vcs'),
  '@macquery-labs/cli': pkg('cli'),
  '@macquery-labs/probe-dap': pkg('probe-dap'),
  '@macquery-labs/driver-api': pkg('driver-api'),
  '@macquery-labs/driver-web': pkg('driver-web'),
  '@macquery-labs/recorders': pkg('recorders'),
  '@macquery-labs/viewer': pkg('viewer'),
  '@macquery-labs/mcp': pkg('mcp'),
}

const tier = (name: string, include: string[], timeoutMs?: number) => ({
  resolve: { alias },
  test: {
    name,
    include,
    environment: 'node' as const,
    ...(timeoutMs ? { testTimeout: timeoutMs, hookTimeout: timeoutMs } : {}),
  },
})

export default defineConfig({
  test: {
    projects: [
      tier('l0', ['packages/*/test/l0/**/*.test.ts']),
      tier('l1', ['packages/*/test/l1/**/*.test.ts'], 120_000),
      tier('l2', ['test/l2/**/*.test.ts'], 180_000),
      tier('l3', ['test/l3/**/*.test.ts'], 180_000),
      tier('l4', ['test/l4/**/*.test.ts'], 180_000),
      tier('arch', ['test/arch/**/*.test.ts']),
    ],
  },
})
