import { existsSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { evaluate, gatedDiff, type GateResult } from '@macquery-labs/core'
import { renderViewer } from '@macquery-labs/viewer'
import { defaultBase, diffAgainst, isGitRepo } from '../git.js'
import { EXIT, UsageError } from '../errors.js'
import { loadPlans, readStory, runDir } from '../workspace.js'
import { latestRun } from './gate.js'
import type { CommandContext, CommandResult } from '../context.js'

/**
 * `show` — render the story as one self-contained page.
 *
 * Evidence nobody reads is theatre (TDD §7.9). The viewer is written into the
 * run directory next to the artefacts it links, because the only way a human
 * ever sees a run is by downloading the CI artifact and opening it.
 */
export async function showCommand(ctx: CommandContext): Promise<CommandResult> {
  ctx.args.assertKnown(['run', 'story', 'open', 'base'])

  const runId = ctx.args.flag('run')
  const explicit = ctx.args.flag('story')
  const storyPath = explicit
    ?? (runId ? join(runDir(ctx.repoRoot, runId, ctx.brand), 'story.json') : latestRun(ctx.repoRoot))

  if (!storyPath || !existsSync(storyPath)) {
    throw new UsageError(
      runId ? `no story for run ${runId}` : 'no run to show',
      'Run `witness run --plan <plan>` first, or pass --story <path>.',
    )
  }

  const story = readStory(storyPath)
  const gate = recomputeGate(ctx, story)

  const target = join(storyPath, '..', 'viewer.html')
  writeFileSync(target, renderViewer({ story, gate }))

  if (ctx.args.bool('open')) openInBrowser(target)

  return {
    exitCode: EXIT.ALLOW,
    text: [`wrote ${ctx.relative(target)}`, 'open it in any browser; it needs no server and makes no network request'],
    json: { command: 'show', viewer: ctx.relative(target), run_id: story.run_id, verdict: gate?.verdict ?? null },
  }
}

/**
 * The gate is recomputed rather than remembered: a verdict a viewer displays
 * has to be the verdict this diff produces now, not the one the run happened
 * to record.
 */
function recomputeGate(ctx: CommandContext, story: ReturnType<typeof readStory>): GateResult | null {
  if (!isGitRepo(ctx.cwd)) return null
  try {
    const base = ctx.args.flag('base') ?? defaultBase(ctx.cwd)
    const diff = gatedDiff(diffAgainst(ctx.cwd, base), ctx.config)
    return evaluate({
      story,
      diff,
      plans: loadPlans(ctx.repoRoot, ctx.brand),
      policy: ctx.config,
      bypass: null,
      now: ctx.now,
      ci: ctx.ci,
    })
  } catch {
    // A story is worth reading even when the diff it referred to has moved on.
    return null
  }
}

function openInBrowser(target: string): void {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  // Best-effort convenience: failing to open a browser is never a verdict.
  execFile(opener, [target], () => {})
}
