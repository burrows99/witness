import { schemaId } from '@swe-verify/core'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plan } from '@swe-verify/core'
import { UsageError } from '../errors.js'
import { paths } from '../workspace.js'
import type { CommandContext, CommandResult } from '../context.js'

/**
 * Scaffolds a plan rather than demanding one (R6: "plan authoring feels like
 * writing tests twice"). The agent fills in steps and assertions; the shape,
 * the scope binding and the schema come for free.
 */
export async function planCommand(ctx: CommandContext): Promise<CommandResult> {
  ctx.args.assertKnown(['intent', 'scope', 'id', 'domain', 'exclude', 'force'])
  const intent = ctx.args.flag('intent', { required: true })!
  const scope = ctx.args.list('scope')
  if (scope.length === 0) {
    throw new UsageError('at least one --scope glob is required', 'A plan binds to a scope, not to a diff hash: `--scope "src/pricing/**"`.')
  }

  const id = ctx.args.flag('id') ?? slugify(intent)
  const plan: Plan = {
    schema: schemaId(ctx.brand, 'plan'),
    id,
    intent,
    domain: ctx.args.flag('domain') ?? ctx.config.domain,
    scope: { include: scope, ...(ctx.args.list('exclude').length ? { exclude: ctx.args.list('exclude') } : {}) },
    fixture: { kind: 'none' },
    steps: [{ seq: 1, driver: 'api', action: 'get', args: { path: '/' } }],
    assertions: [{ id: 'a1', kind: 'http-status', afterStep: 1, expect: { status: 200 } }],
  }

  const dir = paths.plans(ctx.repoRoot, ctx.brand)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${id}.plan.json`)
  if (existsSync(file) && !ctx.args.bool('force')) {
    throw new UsageError(`${ctx.relative(file)} already exists`, 'Pass --force to overwrite, or --id to write a differently named plan.')
  }
  writeFileSync(file, `${JSON.stringify(plan, null, 2)}\n`)

  return {
    exitCode: 0,
    text: [
      `wrote ${ctx.relative(file)}  (${plan.steps.length} step, ${plan.assertions.length} assertion)`,
      'edit the steps and assertions, then commit the plan with your change',
    ],
    json: { command: 'plan', path: ctx.relative(file), plan },
  }
}

function slugify(intent: string): string {
  const slug = intent.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 4).join('-')
  return slug || 'plan'
}
