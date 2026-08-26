import { runCommand } from './run.js'
import { gateCommand } from './gate.js'
import type { CommandContext, CommandResult } from '../context.js'

/**
 * `verify` — run, then gate. The agent's one command (US-2 AC1): one
 * invocation, one artefact, one machine-readable verdict.
 */
export async function verifyCommand(ctx: CommandContext): Promise<CommandResult> {
  ctx.args.assertKnown(['plan', 'base', 'bypass', 'quiet', 'story', 'run', 'record'])
  const run = await runCommand(ctx, { checkArgs: false })
  const gate = await gateCommand(ctx, { checkArgs: false })

  return {
    exitCode: gate.exitCode,
    text: [...run.text, '', ...gate.text],
    // The agent reads a GateResult, whichever command produced it: `verify`
    // and `gate` must never disagree about the shape of a verdict.
    json: gate.json,
    ...(gate.publish ? { publish: gate.publish } : {}),
  }
}
