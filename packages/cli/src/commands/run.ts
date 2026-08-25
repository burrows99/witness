import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createProvider, detectProvider, type ProviderSelector } from '@swe-verify/vcs'
import { defaultBase, diffAgainst, isGitRepo } from '../git.js'
import { EXIT, UsageError } from '../errors.js'
import { loadPlan, paths, planSha } from '../workspace.js'
import { runPlan } from '../runner/run.js'
import type { CommandContext, CommandResult } from '../context.js'
import { VERSION } from '../version.js'

/**
 * `run` — execute a plan and emit a story. The gate is a separate command so
 * the same story can be evaluated again later, by CI, without re-running.
 */
export async function runCommand(ctx: CommandContext, options: { checkArgs?: boolean } = {}): Promise<CommandResult> {
  // `verify` composes run and gate, and checks the union of their flags
  // itself; each sub-command re-checking would reject the other's flags.
  if (options.checkArgs !== false) ctx.args.assertKnown(['plan', 'base'])
  if (!isGitRepo(ctx.cwd)) {
    throw new UsageError('not a git repository', 'Run swe-verify from inside a git worktree; the diff is what gets verified.')
  }

  const planPath = resolvePlanPath(ctx)
  const plan = loadPlan(planPath)
  const base = ctx.args.flag('base') ?? defaultBase(ctx.cwd)
  const diff = diffAgainst(ctx.cwd, base)

  const selector = (ctx.args.flag('vcs') ?? ctx.config.vcs) as ProviderSelector
  const provider = createProvider(detectProvider(ctx.env, selector), { env: ctx.env })
  const change = await provider.describe()

  const outcome = await runPlan({
    plan,
    planSha256: planSha(plan),
    config: ctx.config,
    diff,
    cwd: ctx.cwd,
    env: ctx.env,
    vcs: {
      provider: change.provider,
      ...(change.changeId ? { change_id: change.changeId } : {}),
      ...(change.actor ? { actor: change.actor } : {}),
    },
    cliVersion: VERSION,
  })

  const { coverage, assertions } = outcome.story
  const fired = coverage.summary.fired
  const gateable = coverage.lines.filter((l) => l.class === 'executable' || l.class === 'defensive' || l.class === 'unbound').length

  return {
    exitCode: EXIT.ALLOW,
    text: [
      `  probes     ${coverage.lines.filter((l) => l.probe_id).length} logpoint(s) on ${gateable} changed line(s)   [${coverage.lines.filter((l) => l.verified).length} verified]`,
      `  coverage   ${fired}/${gateable} exercised`,
      `  assertions ${assertions.filter((a) => a.status === 'pass').length}/${assertions.length} passed`,
      `  story      ${ctx.relative(outcome.storyPath)}  (${outcome.story.events.length} events)`,
    ],
    json: { command: 'run', run_id: outcome.runId, story: ctx.relative(outcome.storyPath), summary: coverage.summary },
  }
}

export function resolvePlanPath(ctx: CommandContext): string {
  const explicit = ctx.args.flag('plan')
  if (explicit) {
    if (!existsSync(explicit)) {
      const inDir = join(paths.plans(ctx.cwd), explicit.endsWith('.plan.json') ? explicit : `${explicit}.plan.json`)
      if (existsSync(inDir)) return inDir
      throw new UsageError(`no plan at ${explicit}`, 'Pass a path to a .plan.json, or a plan id that exists in .swe-verify/plans/.')
    }
    return explicit
  }
  throw new UsageError('--plan is required', 'Create one with `swe-verify plan --intent "..." --scope "src/**"`.')
}
