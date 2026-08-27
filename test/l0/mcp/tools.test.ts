import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS, INSTRUCTIONS, argvFor } from '../../../src/mcp/tools.js'
import { COMMANDS } from '../../../src/cli/args.js'

/**
 * The MCP surface is a thin wrapper over the CLI, not a parallel
 * implementation. If MCP and CLI can disagree about a verdict, the design has
 * already failed (TDD §8.2) — so these tests pin that every tool is a CLI
 * invocation, and nothing more.
 *
 * The parity block below is the one that matters. It reads the flag list out
 * of each command's own `assertKnown` call rather than restating it, so a flag
 * added to the CLI and not to MCP fails here instead of being discovered by an
 * agent that cannot ask for it. That is not hypothetical: `verify` shipped
 * without `--record`, so an agent could ask for a verdict but never for the
 * evidence behind it, and no tool took `--cwd`, so a server could only gate
 * the directory its editor happened to launch it from.
 */

const COMMANDS_DIR = join(import.meta.dirname, '..', '..', '..', 'src', 'cli', 'commands')

/** The flags each command declares in its own `assertKnown([...])` call. */
function cliFlags(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const entry of readdirSync(COMMANDS_DIR)) {
    if (!entry.endsWith('.ts')) continue
    const source = readFileSync(join(COMMANDS_DIR, entry), 'utf8')
    const match = /assertKnown\(\[([^\]]*)\]\)/.exec(source)
    if (!match) continue
    const flags = [...match[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
    found.set(entry.replace(/\.ts$/, ''), flags)
  }
  return found
}

const toolsByName = new Map(TOOLS.map((t) => [t.name, t]))

describe('the MCP surface covers the CLI surface', () => {
  it('finds an assertKnown list for every command that takes flags', () => {
    // If this fails the parity check below is silently passing on nothing.
    const flags = cliFlags()
    expect(flags.size).toBeGreaterThanOrEqual(7)
    expect([...flags.keys()]).toEqual(expect.arrayContaining(['verify', 'gate', 'plan', 'run']))
  })

  it('exposes a tool for every command a person can run', () => {
    // `help` is the CLI telling a human what it does; an agent reads the tool
    // descriptions instead.
    const runnable = COMMANDS.filter((c) => c !== 'help')
    expect([...toolsByName.keys()].sort()).toEqual([...runnable].sort())
  })

  it.each([...cliFlags()])('exposes every flag `%s` accepts', (command, flags) => {
    const tool = toolsByName.get(command)
    expect(tool, `no MCP tool for \`witness ${command}\``).toBeDefined()
    const exposed = new Set(tool!.flags.map((f) => f.name))
    for (const flag of flags) {
      expect(exposed.has(flag), `\`witness ${command} --${flag}\` has no MCP argument`).toBe(true)
    }
  })

  it('lets every tool name the repository it runs against', () => {
    // Without this a server can only ever gate the directory it was launched
    // from, which is not usually the repository under review.
    for (const tool of TOOLS) {
      const exposed = new Set(tool.flags.map((f) => f.name))
      expect(exposed.has('cwd'), `${tool.name} cannot take --cwd`).toBe(true)
      expect(exposed.has('vcs'), `${tool.name} cannot take --vcs`).toBe(true)
      expect(tool.inputSchema.properties).toHaveProperty('cwd')
    }
  })

  it('documents every argument it declares', () => {
    for (const tool of TOOLS) {
      for (const flag of tool.flags) {
        expect(tool.inputSchema.properties[flag.name], `${tool.name}.${flag.name} is undocumented`).toBeDefined()
      }
    }
  })
})

describe('tool surface', () => {
  it('describes each tool for a reader who has never seen this project', () => {
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(40)
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  it('marks the arguments an agent must supply', () => {
    expect(toolsByName.get('plan')!.inputSchema.required).toEqual(expect.arrayContaining(['intent', 'scope']))
    expect(toolsByName.get('verify')!.inputSchema.required).toEqual(expect.arrayContaining(['plan']))
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

  it('sends --record as a bare flag, which is how the CLI spells it', () => {
    expect(argvFor('verify', { plan: 'p', record: true })).toEqual(['verify', '--plan', 'p', '--record', '--json'])
  })

  it('omits a boolean the agent set to false rather than passing the word', () => {
    // `--record false` would read as the string "false" and enable recording,
    // which is the opposite of what was asked for.
    expect(argvFor('verify', { plan: 'p', record: false })).toEqual(['verify', '--plan', 'p', '--json'])
  })

  it('refuses a boolean given as a string, rather than guessing', () => {
    expect(() => argvFor('verify', { plan: 'p', record: 'true' })).toThrow(/record/)
  })

  it('points the run at another repository', () => {
    expect(argvFor('verify', { plan: 'p', cwd: '/repos/grafana' }))
      .toEqual(['verify', '--plan', 'p', '--cwd', '/repos/grafana', '--json'])
  })

  it('takes a recorded run in another repository, which is the evidence path', () => {
    expect(argvFor('verify', { plan: 'checkout', record: true, cwd: '/repos/grafana', vcs: 'local' }))
      .toEqual(['verify', '--plan', 'checkout', '--record', '--cwd', '/repos/grafana', '--vcs', 'local', '--json'])
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
    expect(INSTRUCTIONS).toMatch(/witness/)
    expect(INSTRUCTIONS).toMatch(/verify/)
  })

  it('is honest that the gate runs in CI regardless of what the agent does', () => {
    expect(INSTRUCTIONS.toLowerCase()).toMatch(/ci/)
  })

  it('says how to point the server at another repository, and how to ask for evidence', () => {
    expect(INSTRUCTIONS).toMatch(/cwd/)
    expect(INSTRUCTIONS).toMatch(/record/)
  })
})
