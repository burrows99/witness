/**
 * The MCP surface — FR-17.
 *
 * A thin wrapper over the CLI, not a parallel implementation: if MCP and the
 * CLI can disagree about a verdict, the design has already failed (TDD §8.2).
 * Every tool here turns arguments into an argv and runs the same binary CI
 * runs.
 *
 * Parity with the CLI is the invariant, and it is enforced rather than
 * remembered: `test/l0/mcp/tools.test.ts` reads the `assertKnown` list out of
 * every command and fails when a flag exists on one surface and not the other.
 * The gap that test now closes was real — `verify` could not pass `--record`,
 * so an agent could ask for a verdict but never for the evidence behind it,
 * and no tool could name a working directory, so the server could only ever
 * gate the repository it happened to be launched from.
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
  /** Present or absent, with no value — `--record`, not `--record true`. */
  boolean?: boolean
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

/**
 * Accepted by every command (`Args.assertKnown` allows them unconditionally),
 * so every tool takes them too.
 *
 * `cwd` is the one that matters here. An MCP server is launched once, by an
 * editor, from whatever directory that editor happened to be in — and a gate
 * that can only ever run there is a gate that cannot be pointed at the
 * repository under review. With it, one server verifies any checkout on the
 * machine.
 */
const UNIVERSAL_FLAGS: ToolFlag[] = [
  { name: 'cwd', flag: '--cwd' },
  { name: 'vcs', flag: '--vcs' },
]

const UNIVERSAL_PROPERTIES: Record<string, unknown> = {
  cwd: {
    type: 'string',
    description:
      'Directory to run in. Defaults to where the server was launched. Set this to the repository being verified — the config, the plans and the diff are all read from there.',
  },
  vcs: {
    type: 'string',
    enum: ['auto', 'github', 'gitlab', 'bitbucket', 'local'],
    description: 'Host provider. "local" needs no token and no network.',
  },
}

function tool(spec: {
  name: string
  command: string
  description: string
  flags: ToolFlag[]
  properties: Record<string, unknown>
  required?: string[]
}): ToolSpec {
  return {
    name: spec.name,
    command: spec.command,
    description: spec.description,
    flags: [...spec.flags, ...UNIVERSAL_FLAGS],
    inputSchema: {
      type: 'object',
      properties: { ...spec.properties, ...UNIVERSAL_PROPERTIES },
      ...(spec.required ? { required: spec.required } : {}),
    },
  }
}

export const TOOLS: ToolSpec[] = [
  tool({
    name: 'doctor',
    command: 'doctor',
    description:
      'Report what this machine can actually instrument: which language adapters are present, which are missing and what would install them, plus git, config and plan discovery. Call this first when a verify fails for reasons that look environmental — a language with no trustworthy adapter is refused rather than degraded, and this is what says so.',
    flags: [],
    properties: {},
  }),

  tool({
    name: 'init',
    command: 'init',
    description:
      'Scaffold a witness config in a repository that has none. Writes .witness/config.json. Use this before the first plan in a checkout that has never been gated.',
    flags: [
      { name: 'agents', flag: '--agents', boolean: true },
      { name: 'hooks', flag: '--hooks', boolean: true },
      { name: 'vendor', flag: '--vendor' },
    ],
    properties: {
      agents: { type: 'boolean', description: 'Also write an AGENTS.md describing how to work in this repository.' },
      hooks: { type: 'boolean', description: 'Also install git hooks.' },
      vendor: { type: 'string', description: 'Vendor a debug adapter while initialising.' },
    },
  }),

  tool({
    name: 'plan',
    command: 'plan',
    description:
      'Write a verification plan: what this change intends to prove, and which paths it covers. The plan is committed alongside the change so a reviewer can push back on the intent before looking at whether it went green.',
    flags: [
      { name: 'intent', flag: '--intent' },
      { name: 'scope', flag: '--scope', repeated: true },
      { name: 'exclude', flag: '--exclude', repeated: true },
      { name: 'id', flag: '--id' },
      { name: 'domain', flag: '--domain' },
      { name: 'force', flag: '--force', boolean: true },
    ],
    properties: {
      intent: { type: 'string', description: 'What this change proves, in one sentence.' },
      scope: { type: 'array', items: { type: 'string' }, description: 'Path globs the plan covers, e.g. ["src/pricing/**"].' },
      exclude: { type: 'array', items: { type: 'string' }, description: 'Path globs to carve back out of the scope.' },
      id: { type: 'string', description: 'Optional plan id; derived from the intent otherwise.' },
      domain: { type: 'string', description: 'Domain pack the plan is written against, e.g. "fullstack".' },
      force: { type: 'boolean', description: 'Overwrite an existing plan with this id.' },
    },
    required: ['intent', 'scope'],
  }),

  tool({
    name: 'run',
    command: 'run',
    description:
      'Execute a plan and emit a story, without evaluating the gate. Use this when you want the evidence and intend to gate it separately — otherwise call "verify", which does both.',
    flags: [
      { name: 'plan', flag: '--plan' },
      { name: 'base', flag: '--base' },
      { name: 'record', flag: '--record', boolean: true },
    ],
    properties: {
      plan: { type: 'string', description: 'Plan id or path to a .plan.json.' },
      base: { type: 'string', description: 'Commit or branch the diff is taken against.' },
      record: {
        type: 'boolean',
        description:
          'Film the run. Produces the video and terminal artefacts a person can watch, alongside the story an agent reads. Minutes, not seconds — one recorded run of this project took 7m15s. Many MCP clients time a tool call out after 60 seconds unless they opt into resetting that clock on progress, so ask for this only when the evidence is the point, and prefer it over a client you know will wait.',
      },
    },
    required: ['plan'],
  }),

  tool({
    name: 'verify',
    command: 'verify',
    description:
      'Run a plan and evaluate the gate in one step. Returns a GateResult: verdict, findings (each with a remedy) and metrics. This is the command to use after changing code.',
    flags: [
      { name: 'plan', flag: '--plan' },
      { name: 'base', flag: '--base' },
      { name: 'record', flag: '--record', boolean: true },
      { name: 'story', flag: '--story' },
      { name: 'run', flag: '--run' },
      { name: 'bypass', flag: '--bypass' },
      { name: 'quiet', flag: '--quiet', boolean: true },
    ],
    properties: {
      plan: { type: 'string', description: 'Plan id or path to a .plan.json.' },
      base: { type: 'string', description: 'Commit or branch the diff is taken against.' },
      record: {
        type: 'boolean',
        description:
          'Film the run, so the verdict arrives with evidence a person can watch rather than only a story an agent can read. Minutes, not seconds, and subject to the same 60-second client timeout as "run" — if the call may not survive that, use "run" with record and then "gate" on the run id it returns.',
      },
      story: { type: 'string', description: 'Gate an existing story.json instead of producing one.' },
      run: { type: 'string', description: 'Gate an existing run id instead of producing one.' },
      bypass: { type: 'string', description: 'Reason for an explicit, recorded bypass. Amber, never green.' },
      quiet: { type: 'boolean', description: 'Suppress the human-readable report.' },
    },
    required: ['plan'],
  }),

  tool({
    name: 'gate',
    command: 'gate',
    description:
      'Evaluate an existing story against the current diff without re-running it. Returns the same GateResult CI will produce.',
    flags: [
      { name: 'story', flag: '--story' },
      { name: 'run', flag: '--run' },
      { name: 'base', flag: '--base' },
      { name: 'bypass', flag: '--bypass' },
      { name: 'quiet', flag: '--quiet', boolean: true },
    ],
    properties: {
      story: { type: 'string', description: 'Path to a story.json.' },
      run: { type: 'string', description: 'Run id to evaluate.' },
      base: { type: 'string', description: 'Commit or branch the diff is taken against.' },
      bypass: { type: 'string', description: 'Reason for an explicit, recorded bypass. Amber, never green.' },
      quiet: { type: 'boolean', description: 'Suppress the human-readable report.' },
    },
  }),

  tool({
    name: 'show',
    command: 'show',
    description:
      'Render a run as the story viewer — one self-contained HTML file. Returns its path. This is the artefact to hand a person who wants to watch what happened rather than read a verdict.',
    flags: [
      { name: 'run', flag: '--run' },
      { name: 'story', flag: '--story' },
      { name: 'base', flag: '--base' },
      { name: 'open', flag: '--open', boolean: true },
    ],
    properties: {
      run: { type: 'string', description: 'Run id to render.' },
      story: { type: 'string', description: 'Path to a story.json to render.' },
      base: { type: 'string', description: 'Commit or branch the diff is taken against.' },
      open: {
        type: 'boolean',
        description: 'Also open it in a browser. This acts on the machine the server runs on — return the path instead unless a person asked to see it.',
      },
    },
  }),

  tool({
    name: 'skill',
    command: 'skill',
    description:
      "Generate this project's agent skill from its config, committed plans and installed adapters. With check, regenerates in memory and reports whether the committed file is stale, writing nothing.",
    flags: [
      { name: 'out', flag: '--out' },
      { name: 'name', flag: '--name' },
      { name: 'check', flag: '--check', boolean: true },
      { name: 'force', flag: '--force', boolean: true },
    ],
    properties: {
      out: { type: 'string', description: 'Where to write the SKILL.md.' },
      name: { type: 'string', description: 'Skill name; derived from the project otherwise.' },
      check: { type: 'boolean', description: 'Report staleness without writing. Exits 3 when stale.' },
      force: { type: 'boolean', description: 'Overwrite an existing skill file.' },
    },
  }),
]

export const INSTRUCTIONS = `witness proves that the code you changed was actually executed.

After you change code:
  1. Call "plan" once, with what the change proves and the paths it touches. Commit the plan.
  2. Call "verify" with that plan. Read the JSON verdict.
  3. If the verdict is "block", each finding carries a "remedy" saying what to do next.

Every tool takes "cwd". This server verifies whichever repository you name, not
the one it was launched from, so set it to the checkout you are working in.
Call "doctor" there first: a language with no trustworthy adapter is refused
rather than gated, and doctor is what says which languages this machine can
instrument and what would fix the rest.

Pass "record" to "verify" or "run" when the evidence itself is the point. It
films the run, so the verdict arrives with something a person can watch instead
of only a story a machine can read. It costs minutes, not seconds; do not ask
for it on every call.

A long call can outlive the client's patience rather than the run. Progress is
reported for every call that supplies a progressToken, but a notification only
holds off a timeout if the client chose to reset its clock on one, and the usual
default is sixty seconds. When a call may not survive that, split it: "run"
returns a run id as soon as the story is sealed, and "gate" evaluates that id
afterwards in a call that returns immediately. Same verdict, two short calls
instead of one long one.

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

    if (flag.boolean) {
      // `--record false` would read as the string "false" and enable it, which
      // is the opposite of what the agent asked for.
      if (typeof value !== 'boolean') {
        throw new Error(`argument "${flag.name}" must be a boolean, got ${typeof value}`)
      }
      if (value) argv.push(flag.flag)
      continue
    }

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
