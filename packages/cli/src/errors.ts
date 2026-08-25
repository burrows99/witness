import type { GateResult } from '@witness/core'

/**
 * Exit codes — contracts §6.
 *
 * 4 must be distinct from 2. "Your change is unverified" and "our debugger
 * failed to attach" produce identical developer frustration if they share a
 * code, and the second is the failure this project will hit constantly in its
 * first six months (M5). It also keeps catch-rate arithmetic honest: a
 * harness crash is not a catch.
 *
 * 1 is deliberately unused, so an uncaught throw (which Node exits 1 on)
 * can never be mistaken for a verdict.
 */
export const EXIT = {
  ALLOW: 0,
  BLOCK: 2,
  USAGE: 3,
  HARNESS: 4,
  BYPASS: 5,
} as const

export function exitCodeFor(result: GateResult): number {
  switch (result.verdict) {
    case 'allow': return EXIT.ALLOW
    case 'block': return EXIT.BLOCK
    case 'bypass': return EXIT.BYPASS
  }
}

export class UsageError extends Error {
  readonly exitCode = EXIT.USAGE
  constructor(message: string, readonly remedy = 'Run `witness --help`.') {
    super(message)
    this.name = 'UsageError'
  }
}

/** Anything that means "we could not observe", rather than "it is unverified". */
export class HarnessError extends Error {
  readonly exitCode = EXIT.HARNESS
  constructor(message: string, readonly remedy = 'Run `witness doctor` and check .witness/runs/<id>/logs/harness.log.') {
    super(message)
    this.name = 'HarnessError'
  }
}
