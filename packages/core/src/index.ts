/**
 * @swe-verify/core — the gate, the schemas, and the arithmetic behind them.
 *
 * This package is pure by construction: it never touches the filesystem, the
 * network, a browser, a debugger or a VCS host (NFR-7). The gate must run in
 * CI with nothing installed, and `core` receives a resolved bypass as data
 * rather than knowing what a pull request is.
 */
export * from './types.js'
export * from './classify.js'
export * from './diff.js'
export * from './canonical.js'
export * from './glob.js'
export * from './schema.js'
export { planSchema, storySchema, configSchema } from './schemas.js'
export * from './seal.js'
export * from './order.js'
export * from './redact.js'
export * from './ulid.js'
export * from './planargs.js'
export * from './seams.js'
export * from './assertions.js'
export * from './instrument.js'
export * from './findings.js'
export * from './gate.js'

export const SCHEMA_VERSIONS = {
  plan: 'swe-verify/plan@1',
  story: 'swe-verify/story@1',
  config: 'swe-verify/config@1',
} as const
