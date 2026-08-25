import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { scaffold } from '../workspace.js'
import { upsertAgentsBlock, VENDOR_HOOKS } from '../agents.js'
import type { CommandContext, CommandResult } from '../context.js'

export async function initCommand(ctx: CommandContext): Promise<CommandResult> {
  ctx.args.assertKnown(['agents', 'hooks', 'vendor'])
  const { created } = scaffold(ctx.repoRoot)
  const written = [...created]

  // `AGENTS.md` is vendor-neutral steering; it does not bind, and the block is
  // regenerated in place so a human's own rules survive.
  if (ctx.args.bool('agents')) {
    const file = join(ctx.repoRoot, 'AGENTS.md')
    const existing = existsSync(file) ? readFileSync(file, 'utf8') : ''
    const updated = upsertAgentsBlock(existing)
    if (updated !== existing) {
      writeFileSync(file, updated)
      written.push(file)
    }
  }

  if (ctx.args.bool('hooks')) {
    const wanted = ctx.args.list('vendor')
    for (const hook of VENDOR_HOOKS) {
      if (wanted.length > 0 && !wanted.includes(hook.vendor)) continue
      const file = join(ctx.cwd, hook.path)
      // The git hooks directory only exists inside a repository; a vendor
      // shim for a vendor this repo does not use is not an error.
      if (!existsSync(dirname(file))) {
        if (hook.vendor === 'git') continue
        mkdirSync(dirname(file), { recursive: true })
      }
      writeFileSync(file, hook.render())
      if (hook.mode) chmodSync(file, hook.mode)
      written.push(file)
    }
  }

  const lines = written.length
    ? written.map((f) => `wrote ${ctx.relative(f)}`)
    : ['.swe-verify/ already initialised; nothing to do']
  lines.push('next: swe-verify plan --intent "<what this change proves>" --scope "<glob>"')
  return { exitCode: 0, text: lines, json: { command: 'init', created: written.map((f) => ctx.relative(f)) } }
}
