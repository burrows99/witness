import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { adapterReport } from '@macquery-labs/probe-dap'
import { builtinAssertionKinds } from '@macquery-labs/core'
import { assertionKinds } from '@macquery-labs/driver-api'
import { EXIT, UsageError } from '../errors.js'
import { loadFullPlans } from '../workspace.js'
import { renderSkill, skillName, type SkillFacts } from '../skill.js'
import type { CommandContext, CommandResult } from '../context.js'

/**
 * `skill` — generate the agent-facing skill for *this* project.
 *
 * The alternative is a hand-written file that describes the project on the day
 * someone wrote it. Generating it means the plans an agent is told about are
 * the plans that exist, the languages it is told are gateable are the ones
 * with an adapter installed, and the policies it is told about are the ones in
 * config. Re-run it and the skill catches up.
 *
 * `--check` is what keeps that true without anyone remembering: it regenerates
 * in memory and compares, so CI fails on a stale skill. That is the same
 * argument the product makes about itself — steering that nobody enforces
 * drifts, so the enforcement belongs in CI.
 */
export async function skillCommand(ctx: CommandContext): Promise<CommandResult> {
  ctx.args.assertKnown(['out', 'name', 'check', 'force'])

  const facts = await gatherFacts(ctx)
  const name = ctx.args.flag('name') ?? skillName(facts.project)
  if (!/^[a-z0-9-]{1,64}$/.test(name)) {
    throw new UsageError(
      `"${name}" is not a valid skill name`,
      'Use lowercase letters, numbers and hyphens, at most 64 characters.',
    )
  }

  const target = ctx.args.flag('out') ?? join('.claude', 'skills', name, 'SKILL.md')
  const absolute = join(ctx.cwd, target)
  const generated = renderSkill({ ...facts })

  if (ctx.args.bool('check')) {
    const current = existsSync(absolute) ? readFileSync(absolute, 'utf8') : null
    if (current === generated) {
      return {
        exitCode: EXIT.ALLOW,
        text: [`${target} is up to date with this project`],
        json: { command: 'skill', path: target, name, stale: false, plans: facts.plans.length },
      }
    }

    // Staleness is a *result*, not a crash: the caller gets a structured
    // answer on stdout and a readable one on stderr. It exits 3 because a
    // stale skill is a configuration problem, not a verdict about the code —
    // and it never writes, since a check that repairs what it is checking
    // cannot fail twice.
    const reason = current === null
      ? `${target} does not exist, but this project has ${facts.plans.length} plan(s) to describe`
      : `${target} no longer matches this project`
    return {
      exitCode: EXIT.USAGE,
      text: [],
      stderrText: [`witness: ${reason}`, '  → Run `witness skill` and commit the result.'],
      json: { command: 'skill', path: target, name, stale: true, reason, plans: facts.plans.length },
    }
  }

  mkdirSync(dirname(absolute), { recursive: true })
  const unchanged = existsSync(absolute) && readFileSync(absolute, 'utf8') === generated
  writeFileSync(absolute, generated)

  return {
    exitCode: EXIT.ALLOW,
    text: [
      `${unchanged ? 'unchanged' : 'wrote'} ${target}`,
      facts.plans.length === 0
        ? 'no plans yet — the skill tells the agent to write the first one'
        : `describes ${facts.plans.length} plan(s): ${facts.plans.map((p) => p.id).join(', ')}`,
      'regenerate whenever the project changes; `witness skill --check` fails in CI when it is stale',
    ],
    json: { command: 'skill', path: target, name, stale: false, plans: facts.plans.length },
  }
}

async function gatherFacts(ctx: CommandContext): Promise<SkillFacts> {
  const plans = loadFullPlans(ctx.cwd)
  const browser = await import('@macquery-labs/driver-web')
    .then((web) => web.isPlaywrightAvailable())
    .catch(() => false)

  return {
    project: projectName(ctx.cwd),
    plans: plans.map((plan) => ({
      id: plan.id,
      intent: plan.intent,
      include: plan.scope.include,
      exclude: plan.scope.exclude ?? [],
      assertions: plan.assertions.length,
      fixture: plan.fixture?.kind ?? 'none',
    })),
    adapters: adapterReport(ctx.cwd, ctx.env).map((adapter) => ({
      language: adapter.language,
      name: adapter.name,
      available: adapter.available,
      detail: adapter.detail,
      ...(adapter.remedy ? { remedy: adapter.remedy } : {}),
    })),
    browser,
    // What this build ships, not what the design lists — the skill must not
    // name an assertion kind the runner cannot evaluate.
    assertionKinds: [
      ...builtinAssertionKinds().map((k) => k.kind),
      ...assertionKinds().map((k) => k.kind),
      ...(browser ? ['ui-text'] : []),
    ],
    scope: ctx.config.scope,
    policy: {
      defensive: ctx.config.coverage.defensive,
      waiverCapPct: ctx.config.coverage.waiverCapPct,
      bypassLabel: ctx.config.bypass.label,
      runMs: ctx.config.budgets.runMs,
      probeLines: ctx.config.budgets.probeLines,
    },
  }
}

/** The project's own name if it has one, else the directory it lives in. */
function projectName(cwd: string): string {
  const manifest = join(cwd, 'package.json')
  if (existsSync(manifest)) {
    try {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }
      if (typeof parsed.name === 'string' && parsed.name.trim()) {
        // A scoped name reads badly in a title: `@acme/checkout` → `checkout`.
        return parsed.name.replace(/^@[^/]+\//, '').trim()
      }
    } catch {
      // An unparseable manifest is not this command's problem to report.
    }
  }
  return basename(cwd) || 'this project'
}

