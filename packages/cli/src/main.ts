import { appendFileSync } from 'node:fs'
import { parseArgs, type Args } from './args.js'
import { EXIT, HarnessError, UsageError } from './errors.js'
import { loadConfig } from './workspace.js'
import { makeContext, type CommandResult } from './context.js'
import { initCommand } from './commands/init.js'
import { planCommand } from './commands/plan.js'
import { gateCommand } from './commands/gate.js'
import { doctorCommand } from './commands/doctor.js'
import { runCommand } from './commands/run.js'
import { verifyCommand } from './commands/verify.js'
import { showCommand } from './commands/show.js'
import { skillCommand } from './commands/skill.js'

import { VERSION } from './version.js'

const HELP = `swe-verify ${VERSION} — prove a change was actually executed

  swe-verify init [--agents] [--hooks]               scaffold config, AGENTS.md, hooks
  swe-verify plan   --intent <s> --scope <glob>...   emit a plan skeleton
  swe-verify run    --plan <path>                    execute, emit story
  swe-verify gate   --run <id> | --story <path>      evaluate, publish
  swe-verify verify --plan <path>                    run + gate (one command)
  swe-verify show   --run <id> [--open]              render viewer
  swe-verify skill  [--out <path>] [--check]         generate this project's agent skill
  swe-verify doctor                                  adapters, ports, path mappings

Common flags
  --json          emit machine-readable output on stdout and nothing else
  --vcs <name>    auto | github | gitlab | bitbucket | local
  --base <ref>    the commit the diff is taken against
  --bypass <why>  record an explicit, reasoned bypass (exit 5, amber)
  --cwd <path>    run against another working directory

Exit codes
  0 allow   2 block   3 usage/config   4 harness failure   5 bypassed`

export interface RunOptions {
  argv: readonly string[]
  cwd?: string
  env?: Record<string, string | undefined>
  stdout?: NodeJS.WritableStream
  stderr?: NodeJS.WritableStream
  now?: Date
}

/**
 * The CLI is the single source of truth: CI runs the same binary the agent
 * runs, so there is one gate and no drift (TDD §8.1).
 */
export async function run(options: RunOptions): Promise<number> {
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr
  const env = options.env ?? process.env
  let args: Args

  try {
    args = parseArgs(options.argv)
  } catch (error) {
    return fail(error, stderr, options.argv.includes('--json'))
  }

  const json = args.bool('json')
  if (args.command === 'help' || args.bool('help')) {
    stdout.write(json ? `${JSON.stringify({ command: 'help', version: VERSION })}\n` : `${HELP}\n`)
    return EXIT.ALLOW
  }

  try {
    const cwd = args.flag('cwd') ?? options.cwd ?? process.cwd()
    const config = loadConfig(cwd)
    const ctx = makeContext(args, config, cwd, env, options.now)

    let result: CommandResult
    switch (args.command) {
      case 'init': result = await initCommand(ctx); break
      case 'plan': result = await planCommand(ctx); break
      case 'gate': result = await gateCommand(ctx); break
      case 'doctor': result = await doctorCommand(ctx); break
      case 'run': result = await runCommand(ctx); break
      case 'verify': result = await verifyCommand(ctx); break
      case 'show': result = await showCommand(ctx); break
      case 'skill': result = await skillCommand(ctx); break
      default: {
        // Provably unreachable: every Command has a case above. The binding
        // is what makes adding a command without handling it a type error.
        const unhandled: never = args.command
        throw new UsageError(`unhandled command ${String(unhandled)}`)
      }
    }

    if (json) stdout.write(`${JSON.stringify(result.json)}\n`)
    else for (const line of result.text) stdout.write(`${line}\n`)
    for (const line of result.stderrText ?? []) stderr.write(`${line}\n`)

    // A host job summary is a side channel, never stdout: --json must stay
    // parseable.
    if (result.publish?.summaries.length && env.GITHUB_STEP_SUMMARY) {
      try { appendFileSync(env.GITHUB_STEP_SUMMARY, `${result.publish.summaries.join('\n')}\n`) } catch { /* best effort */ }
    }
    return result.exitCode
  } catch (error) {
    return fail(error, stderr, json)
  }
}

function fail(error: unknown, stderr: NodeJS.WritableStream, json: boolean): number {
  const isUsage = error instanceof UsageError
  const isHarness = error instanceof HarnessError
  // Anything unrecognised is *our* failure, not the developer's change being
  // unverified: it exits 4, never 2 (FR-8).
  const exitCode = isUsage ? EXIT.USAGE : isHarness ? EXIT.HARNESS : EXIT.HARNESS
  const message = error instanceof Error ? error.message : String(error)
  const remedy = (error as { remedy?: string }).remedy
    ?? 'This is a harness failure, not a verdict. Run `swe-verify doctor`; if it persists, file it with logs/harness.log.'

  if (json) {
    stderr.write(`${JSON.stringify({ error: { kind: isUsage ? 'usage' : 'harness', message, remedy }, exitCode })}\n`)
  } else {
    stderr.write(`swe-verify: ${message}\n  → ${remedy}\n`)
  }
  return exitCode
}
