import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { evaluate, type GateResult, type Story } from '@swe-verify/core'
import { CollectTarget, createProvider, detectProvider, type ProviderSelector } from '@swe-verify/vcs'
import { defaultBase, diffAgainst, isGitRepo } from '../git.js'
import { exitCodeFor, UsageError } from '../errors.js'
import { loadPlans, paths, readStory, runDir } from '../workspace.js'
import type { CommandContext, CommandResult } from '../context.js'

/**
 * `gate` — evaluate a story against the diff it claims to verify, and
 * publish the verdict.
 *
 * Everything host-shaped happens here, at the edge: reading a bypass signal
 * and publishing. The decision itself is `core.evaluate`, a pure function.
 */
export async function gateCommand(ctx: CommandContext, options: { checkArgs?: boolean } = {}): Promise<CommandResult> {
  if (options.checkArgs !== false) ctx.args.assertKnown(['story', 'run', 'base', 'bypass', 'quiet'])
  if (!isGitRepo(ctx.cwd)) {
    throw new UsageError('not a git repository', 'Run swe-verify from inside a git worktree; the diff is what gets gated.')
  }

  const base = ctx.args.flag('base') ?? defaultBase(ctx.cwd)
  const diff = diffAgainst(ctx.cwd, base)
  const plans = loadPlans(ctx.cwd)
  const story = resolveStory(ctx)

  const selector = (ctx.args.flag('vcs') ?? ctx.config.vcs) as ProviderSelector
  const provider = createProvider(detectProvider(ctx.env, selector), {
    env: ctx.env,
    bypassLabel: ctx.config.bypass.label,
    ...(ctx.args.flag('bypass') !== undefined ? { bypassReason: ctx.args.flag('bypass') } : {}),
  })

  const result = evaluate({
    story,
    diff,
    plans,
    policy: ctx.config,
    bypass: await provider.resolveBypass(),
    now: ctx.now,
    ci: ctx.ci,
  })

  // Publishing is reporting, not deciding: it runs after the verdict and
  // cannot change it.
  const target = new CollectTarget()
  await provider.publish(result, target)

  return {
    exitCode: exitCodeFor(result),
    text: [...target.lines, ...(ctx.args.bool('quiet') ? [] : summaryFooter(result, base, story))],
    json: result,
    publish: { lines: target.lines, summaries: target.summaries },
  }
}

function summaryFooter(result: GateResult, base: string, story: Story | null): string[] {
  const lines: string[] = []
  if (result.verdict !== 'allow') {
    lines.push('')
    lines.push(`  base       ${base.slice(0, 12)}`)
    lines.push(`  story      ${story ? story.run_id : 'none'}`)
  }
  return lines
}

/**
 * A story comes from `--story`, from `--run <id>`, or from the most recent
 * run directory. No story at all is not an error here — it is exactly the
 * condition SV001 exists to report.
 */
function resolveStory(ctx: CommandContext): Story | null {
  const explicit = ctx.args.flag('story')
  if (explicit) {
    if (!existsSync(explicit)) throw new UsageError(`no story at ${explicit}`, 'Check the path, or run `swe-verify run` first.')
    return readStory(explicit)
  }

  const runId = ctx.args.flag('run')
  if (runId) {
    const file = join(runDir(ctx.cwd, runId), 'story.json')
    if (!existsSync(file)) throw new UsageError(`no story for run ${runId}`, 'Check `swe-verify run` completed and wrote a story.')
    return readStory(file)
  }

  const latest = latestRun(ctx.cwd)
  return latest ? readStory(latest) : null
}

export function latestRun(cwd: string): string | null {
  const dir = paths.runs(cwd)
  if (!existsSync(dir)) return null
  const candidates = readdirSync(dir)
    .map((id) => join(dir, id, 'story.json'))
    .filter((file) => existsSync(file))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return candidates[0] ?? null
}

