import { defineConfig } from 'vitest/config'

/**
 * Test tiers — TDD §12. The pyramid is inverted on purpose: the risk is not
 * "is the logic correct" but "does this work on real, messy code", so the
 * expensive tiers carry the weight and are selected explicitly.
 *
 * One package, so tests import sources by relative path and there is nothing
 * to alias: what the tests run is what ships.
 *
 * L1's 120s is not tight: all fourteen Go adapter-contract cases finish in
 * about twelve seconds from a cold `go clean -cache`. A case that reaches the
 * timeout is stuck, not slow, and lengthening the wait only delays finding
 * out.
 */
const tier = (name: string, include: string[], timeoutMs?: number) => ({
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
      tier('l0', ['test/l0/**/*.test.ts']),
      tier('l1', ['test/l1/**/*.test.ts'], 120_000),
      tier('l2', ['test/l2/**/*.test.ts'], 180_000),
      tier('l3', ['test/l3/**/*.test.ts'], 180_000),
      tier('l4', ['test/l4/**/*.test.ts'], 180_000),
      tier('arch', ['test/arch/**/*.test.ts']),
    ],
  },
})
