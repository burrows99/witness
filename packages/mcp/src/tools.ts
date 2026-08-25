/**
 * The MCP surface — FR-17.
 *
 * A thin wrapper over the CLI, not a parallel implementation: if MCP and the
 * CLI can disagree about a verdict, the design has already failed (TDD §8.2).
 * Every tool here turns arguments into an argv and runs the same binary CI
 * runs.
 *
 * MCP `instructions` steer; they do not bind. That is the whole reason the
 * enforcement lives in CI (TDD §4) — an agent is free to ignore all of this,
 * and the gate still holds.
 */

interface ToolFlag {
  /** Argument name as the agent supplies it. */
  name: string
  /** CLI flag it maps to. */
  flag: string
  /** Repeat the flag once per array element. */
  repeated?: boolean
}

export interface ToolSpec {
  name: string
  description: string
  command: string
  flags: ToolFlag[]
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export const TOOLS: ToolSpec[] = [
  {
    name: 'plan',
    command: 'plan',
    description:
      'Write a verification plan: what this change intends to prove, and which paths it covers. The plan is committed alongside the change so a reviewer can push back on the intent before looking at whether it went green.',
    flags: [
      { name: 'intent', flag: '--intent' },
      { name: 'scope', flag: '--scope', repeated: true },
      { name: 'id', flag: '--id' },
    ],
    inputSchema: {
      type: 'object',
      properties: {
        intent: { type: 'string', description: 'What this change proves, in one sentence.' },
        scope: { type: 'array', items: { type: 'string' }, description: 'Path globs the plan covers, e.g. ["src/pricing/**"].' },
        id: { type: 'string', description: 'Optional plan id; derived from the intent otherwise.' },
      },
      required: ['intent', 'scope'],
    },
  },
  {
    name: 'verify',
    command: 'verify',
    description:
      'Run a plan and evaluate the gate in one step. Returns a GateResult: verdict, findings (each with a remedy) and metrics. This is the command to use after changing code.',
    flags: [
      { name: 'plan', flag: '--plan' },
      { name: 'base', flag: '--base' },
    ],
    inputSchema: {
      type: 'object',
      properties: {
        plan: { type: 'string', description: 'Plan id or path to a .plan.json.' },
        base: { type: 'string', description: 'Commit or branch the diff is taken against.' },
      },
      required: ['plan'],
    },
  },
  {
    name: 'gate',
    command: 'gate',
    description:
      'Evaluate an existing story against the current diff without re-running it. Returns the same GateResult CI will produce.',
    flags: [
      { name: 'story', flag: '--story' },
      { name: 'run', flag: '--run' },
      { name: 'base', flag: '--base' },
      { name: 'bypass', flag: '--bypass' },
    ],
    inputSchema: {
      type: 'object',
      properties: {
        story: { type: 'string', description: 'Path to a story.json.' },
        run: { type: 'string', description: 'Run id to evaluate.' },
        base: { type: 'string', description: 'Commit or branch the diff is taken against.' },
        bypass: { type: 'string', description: 'Reason for an explicit, recorded bypass. Amber, never green.' },
      },
    },
  },
]

export const INSTRUCTIONS = `swe-verify proves that the code you changed was actually executed.

After you change code:
  1. Call "plan" once, with what the change proves and the paths it touches. Commit the plan.
  2. Call "verify" with that plan. Read the JSON verdict.
  3. If the verdict is "block", each finding carries a "remedy" saying what to do next.

The same gate runs in CI whether or not you use these tools, and it blocks a
merge when a changed line was never exercised, when the evidence is stale, or
when an assertion failed. Using these tools is how you find that out before
review, not a way to avoid it.

Never treat "block" as a reason to weaken the plan's scope or its assertions.`

const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]))

/**
 * Build the argv for a tool call. Only declared flags are forwarded — an
 * argument the tool does not know about is dropped rather than passed to a
 * shell-adjacent surface.
 */
export function argvFor(toolName: string, args: Record<string, unknown>): string[] {
  const tool = TOOLS_BY_NAME.get(toolName)
  if (!tool) throw new Error(`unknown tool "${toolName}"`)

  const argv: string[] = [tool.command]
  for (const flag of tool.flags) {
    const value = args[flag.name]
    if (value === undefined || value === null) continue

    if (flag.repeated) {
      const values = Array.isArray(value) ? value : [value]
      for (const item of values) {
        argv.push(flag.flag, requireString(flag.name, item))
      }
      continue
    }
    argv.push(flag.flag, requireString(flag.name, value))
  }
  // The agent's read path is JSON on stdout; it never parses human output.
  argv.push('--json')
  return argv
}

function requireString(name: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(`argument "${name}" must be a string, got ${typeof value}`)
  }
  return value
}
