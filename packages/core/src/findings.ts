import type { GateCode, Severity } from './types.js'

/**
 * The finding taxonomy, in one place.
 *
 * Codes are the contract with every consumer — the viewer, the CI annotation,
 * the agent reading JSON, the generated skill, the mutation harness. Freeze
 * them at P0 and only append (TDD §10.5). Keeping the human-readable meaning
 * here as well is what stops a code meaning one thing in the gate and another
 * in the documentation.
 */

export interface FindingDescription {
  summary: string
  /** `policy` means the configuration decides whether it blocks. */
  severity: Severity | 'policy'
}

export const FINDING_CATALOG: Record<GateCode, FindingDescription> = {
  SV001: { summary: 'no story for this change — nothing was run', severity: 'error' },
  SV002: { summary: 'story fails schema validation, or is a schema major this build does not understand', severity: 'error' },
  SV003: { summary: 'stale evidence — the code changed after the story was sealed', severity: 'error' },
  SV004: { summary: 'the story ran a different plan than the one committed in the tree', severity: 'error' },
  SV010: { summary: 'a changed line was never executed', severity: 'error' },
  SV011: { summary: 'a probe was accepted but never verified — the line was never watched', severity: 'error' },
  SV012: { summary: 'a changed file is not covered by any plan scope', severity: 'error' },
  SV013: { summary: 'a coverage waiver expired, or is about to', severity: 'error' },
  SV014: { summary: 'a defensive line was never exercised', severity: 'policy' },
  SV015: { summary: 'waivers cover more of the diff than the configured cap allows', severity: 'error' },
  SV016: { summary: 'changed code in a language with no trustworthy debug adapter, so it was not gated', severity: 'warn' },
  SV020: { summary: 'an assertion failed', severity: 'error' },
  SV021: { summary: 'the plan has no assertions, so a green run proves execution but not behaviour', severity: 'warn' },
  SV022: { summary: 'a plan step failed, so the run did not execute as written', severity: 'warn' },
  SV030: { summary: 'a step produced no artefact its primary reader — the agent — can read', severity: 'error' },
  SV040: { summary: 'a suspending breakpoint was used in CI', severity: 'error' },
  SV041: { summary: 'the run exceeded its time budget', severity: 'error' },
  SV090: { summary: 'the gate was bypassed, with a recorded reason', severity: 'warn' },
}

export function findingSummary(code: GateCode): string {
  return FINDING_CATALOG[code]?.summary ?? ''
}

/** Codes that always block, for documentation that has to be exact. */
export function blockingCodes(): GateCode[] {
  return (Object.keys(FINDING_CATALOG) as GateCode[]).filter((code) => FINDING_CATALOG[code].severity === 'error')
}
