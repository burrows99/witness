import { UsageError } from './errors.js'
export { UsageError } from './errors.js'

/**
 * A hand-rolled parser. The CLI is the agent's entire interface, so its
 * dependency surface is kept at zero and its failure mode is exit 3 with a
 * message rather than a stack trace.
 */

export const COMMANDS = ['init', 'plan', 'run', 'gate', 'verify', 'show', 'doctor', 'help'] as const
export type Command = (typeof COMMANDS)[number]

export interface FlagOptions {
  required?: boolean
  default?: string
}

export class Args {
  constructor(
    readonly command: Command,
    private readonly flags: Map<string, string[]>,
    readonly positionals: string[],
  ) {}

  flag(name: string, options: FlagOptions = {}): string | undefined {
    const values = this.flags.get(name)
    const value = values?.[values.length - 1]
    if (value === undefined || value === '') {
      if (options.required) throw new UsageError(`--${name} is required for \`swe-verify ${this.command}\``)
      return options.default
    }
    return value
  }

  list(name: string): string[] {
    return this.flags.get(name)?.filter((v) => v !== '') ?? []
  }

  bool(name: string): boolean {
    const values = this.flags.get(name)
    if (!values) return false
    const last = values[values.length - 1]
    return last === '' || last === 'true'
  }

  has(name: string): boolean {
    return this.flags.has(name)
  }

  /** Unknown flags are an error: a typo must not silently disable a check. */
  assertKnown(known: readonly string[]): void {
    const allowed = new Set([...known, 'json', 'help', 'cwd', 'vcs'])
    for (const name of this.flags.keys()) {
      if (!allowed.has(name)) {
        throw new UsageError(`unknown flag --${name} for \`swe-verify ${this.command}\``)
      }
    }
  }
}

export function parseArgs(argv: readonly string[]): Args {
  const flags = new Map<string, string[]>()
  const positionals: string[] = []
  let command: Command | null = null
  let i = 0

  if (argv[0] && !argv[0].startsWith('-')) {
    const candidate = argv[0]
    if (!(COMMANDS as readonly string[]).includes(candidate)) {
      throw new UsageError(`unknown command "${candidate}" (expected one of: ${COMMANDS.join(', ')})`)
    }
    command = candidate as Command
    i = 1
  }

  for (; i < argv.length; i += 1) {
    const token = argv[i]!
    if (token.startsWith('--')) {
      const body = token.slice(2)
      const eq = body.indexOf('=')
      if (eq >= 0) {
        push(flags, body.slice(0, eq), body.slice(eq + 1))
        continue
      }
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('-')) {
        push(flags, body, next)
        i += 1
      } else {
        push(flags, body, '')
      }
      continue
    }
    positionals.push(token)
  }

  if (!command) {
    if (flags.has('help') || flags.has('version')) return new Args('help', flags, positionals)
    throw new UsageError(`no command given (expected one of: ${COMMANDS.filter((c) => c !== 'help').join(', ')})`)
  }
  return new Args(command, flags, positionals)
}

function push(flags: Map<string, string[]>, name: string, value: string) {
  const existing = flags.get(name)
  if (existing) existing.push(value)
  else flags.set(name, [value])
}
