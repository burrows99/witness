import { describe, expect, it } from 'vitest'
import { TOOLS, INSTRUCTIONS, argvFor } from '../../src/tools.js'

/**
 * The MCP surface is a thin wrapper over the CLI, not a parallel
 * implementation. If MCP and CLI can disagree about a verdict, the design has
 * already failed (TDD §8.2) — so these tests pin that every tool is a CLI
 * invocation, and nothing more.
 */

describe('tool surface', () => {
  it('exposes exactly plan, verify and gate', () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(['gate', 'plan', 'verify'])
  })

  it('describes each tool for a reader who has never seen this project', () => {
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(40)
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  it('marks the arguments an agent must supply', () => {
    const plan = TOOLS.find((t) => t.name === 'plan')!
    expect(plan.inputSchema.required).toEqual(expect.arrayContaining(['intent', 'scope']))
  })
})

describe('argvFor — every tool is a CLI invocation', () => {
  it('always requests JSON, because the agent must never parse prose', () => {
    for (const tool of TOOLS) expect(argvFor(tool.name, { intent: 'x', scope: ['src/**'], plan: 'p' })).toContain('--json')
  })

  it('maps plan arguments onto flags, repeating --scope per glob', () => {
    expect(argvFor('plan', { intent: 'checkout discounts', scope: ['src/**', 'server/**'] }))
      .toEqual(['plan', '--intent', 'checkout discounts', '--scope', 'src/**', '--scope', 'server/**', '--json'])
  })

  it('passes the plan through to verify', () => {
    expect(argvFor('verify', { plan: 'checkout' })).toEqual(['verify', '--plan', 'checkout', '--json'])
  })

  it('passes an optional base through to gate', () => {
    expect(argvFor('gate', { base: 'origin/main' })).toEqual(['gate', '--base', 'origin/main', '--json'])
  })

  it('carries a bypass reason, since a bypass without one is refused', () => {
    expect(argvFor('gate', { bypass: 'adapter is down' })).toEqual(['gate', '--bypass', 'adapter is down', '--json'])
  })

  it('ignores arguments a tool does not declare, rather than forwarding them', () => {
    expect(argvFor('verify', { plan: 'p', rm: '-rf /' })).toEqual(['verify', '--plan', 'p', '--json'])
  })

  it('refuses an unknown tool', () => {
    expect(() => argvFor('exfiltrate', {})).toThrow(/exfiltrate/)
  })

  it('rejects a non-string argument instead of coercing it into a flag', () => {
    expect(() => argvFor('verify', { plan: { toString: 'nope' } })).toThrow(/plan/)
  })
})

describe('instructions — steering, not enforcement', () => {
  it('tells the agent what the gate blocks on', () => {
    expect(INSTRUCTIONS).toMatch(/swe-verify/)
    expect(INSTRUCTIONS).toMatch(/verify/)
  })

  it('is honest that the gate runs in CI regardless of what the agent does', () => {
    expect(INSTRUCTIONS.toLowerCase()).toMatch(/ci/)
  })
})
