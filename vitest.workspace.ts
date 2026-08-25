import { defineWorkspace } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Tests always run against sources, never a stale dist/. The published
// packages resolve through their own exports map; only the test run aliases.
const pkg = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))
const alias = {
  '@swe-verify/core': pkg('core'),
  '@swe-verify/vcs': pkg('vcs'),
  '@swe-verify/cli': pkg('cli'),
  '@swe-verify/probe-dap': pkg('probe-dap'),
  '@swe-verify/probe-otel': pkg('probe-otel'),
  '@swe-verify/driver-api': pkg('driver-api'),
  '@swe-verify/driver-web': pkg('driver-web'),
  '@swe-verify/recorders': pkg('recorders'),
  '@swe-verify/viewer': pkg('viewer'),
}

// Test tiers per TDD §12. L0 runs on every commit in <5s; the expensive
// tiers carry the weight and are selected explicitly.
export default defineWorkspace([
  { resolve: { alias }, test: { name: 'l0', include: ['packages/*/test/l0/**/*.test.ts'], environment: 'node' } },
  { resolve: { alias }, test: { name: 'l1', include: ['packages/*/test/l1/**/*.test.ts'], environment: 'node', testTimeout: 60_000, hookTimeout: 120_000 } },
  { resolve: { alias }, test: { name: 'l2', include: ['test/l2/**/*.test.ts'], environment: 'node', testTimeout: 180_000, hookTimeout: 180_000 } },
  { resolve: { alias }, test: { name: 'l3', include: ['test/l3/**/*.test.ts'], environment: 'node', testTimeout: 180_000, hookTimeout: 180_000 } },
  { resolve: { alias }, test: { name: 'l4', include: ['test/l4/**/*.test.ts'], environment: 'node', testTimeout: 180_000 } },
  { resolve: { alias }, test: { name: 'arch', include: ['test/arch/**/*.test.ts'], environment: 'node' } },
])
