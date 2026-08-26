import { execFileSync } from 'node:child_process'
import { compileRedactionPolicy, SUPPORTED_LANGUAGES } from '../../core/index.js'
import { adapterReport } from '../../probe-dap/index.js'
import { isGitRepo } from '../git.js'
import { configSource, loadPlans, paths } from '../workspace.js'
import { EXIT } from '../errors.js'
import type { CommandContext, CommandResult, DoctorCheck } from '../context.js'

/**
 * `doctor` — diagnose adapter, port and path-mapping problems without running
 * a verification (FR-14). The first six months of this project are dominated
 * by "the probe never fired", and the answer is almost always environmental.
 */

export type Check = DoctorCheck

export async function doctorCommand(ctx: CommandContext): Promise<CommandResult> {
  ctx.args.assertKnown([])
  const checks: Check[] = []

  checks.push(binaryCheck('git', ['--version']))
  checks.push({
    name: 'repository',
    status: isGitRepo(ctx.cwd) ? 'ok' : 'error',
    detail: isGitRepo(ctx.cwd) ? ctx.cwd : `${ctx.cwd} is not a git worktree`,
    ...(isGitRepo(ctx.cwd) ? {} : { remedy: 'Run witness from inside a git worktree.' }),
  })

  checks.push({
    name: 'config',
    status: 'ok',
    // Where it came from, not only what it says. A branch taken from before
    // the config was committed silently has none, and every run then uses
    // built-in budgets — which is how a plan sat past a 10-minute default for
    // forty minutes with nothing anywhere saying the file was absent.
    detail: `${configSource(ctx.repoRoot, ctx.brand) ?? 'built-in defaults (no .witness/config.json)'} — domain=${ctx.config.domain} runner=${ctx.config.runner} store=${ctx.config.artifactStore} telemetry=${ctx.config.telemetry}`,
    ...(configSource(ctx.repoRoot, ctx.brand) ? {} : { remedy: 'Run `witness init` to create one, and commit it — budgets and scope are per-project.' }),
  })

  const plansDir = paths.plans(ctx.repoRoot, ctx.brand)
  try {
    const plans = loadPlans(ctx.repoRoot, ctx.brand)
    checks.push({
      name: 'plans',
      status: plans.length ? 'ok' : 'warn',
      detail: plans.length ? `${plans.length} plan(s) in ${ctx.relative(plansDir)}` : 'no plans committed',
      ...(plans.length ? {} : { remedy: 'Create one with `witness plan --intent "..." --scope "src/**"`.' }),
    })
  } catch (error) {
    checks.push({ name: 'plans', status: 'error', detail: (error as Error).message, remedy: 'Fix or regenerate the plan.' })
  }

  const policy = compileRedactionPolicy(ctx.config.redact)
  checks.push({
    name: 'redaction',
    status: policy.invalidPatterns.length ? 'warn' : 'ok',
    detail: policy.invalidPatterns.length
      ? `${policy.invalidPatterns.length} redaction pattern(s) failed to compile and are ignored: ${policy.invalidPatterns.join(', ')}`
      : `${policy.keys.length} key rule(s), ${policy.patterns.length} pattern(s), unknown binary: ${policy.onUnknownBinary}`,
    ...(policy.invalidPatterns.length ? { remedy: 'Fix the pattern in config.redact.patterns; an unparseable pattern redacts nothing.' } : {}),
  })

  checks.push({
    name: 'languages',
    status: 'ok',
    detail: `gate supports ${SUPPORTED_LANGUAGES.join(', ')}; anything else is refused rather than degraded`,
  })

  // One row per declared language. A missing adapter is a warning, not an
  // error: the gate itself runs fine without a debugger — only instrumenting
  // that language does not (NFR-7, NFR-12).
  for (const adapter of adapterReport(ctx.cwd, ctx.env)) {
    checks.push({
      name: `adapter:${adapter.language}`,
      status: adapter.available ? 'ok' : 'warn',
      detail: adapter.detail,
      ...(adapter.remedy ? { remedy: adapter.remedy } : {}),
    })
  }

  const browser = await import('../../driver-web/index.js')
    .then((web) => web.isPlaywrightAvailable())
    .catch(() => false)
  checks.push({
    name: 'browser',
    status: browser ? 'ok' : 'warn',
    detail: browser ? 'playwright is installed; the web driver is available' : 'playwright is not installed; plans using the web driver will refuse',
    ...(browser ? {} : { remedy: 'npm i -D playwright && npx playwright install chromium — only needed for plans that drive a browser.' }),
  })

  checks.push({
    name: 'network',
    status: ctx.config.telemetry === 'off' ? 'ok' : 'warn',
    detail: ctx.config.telemetry === 'off' ? 'telemetry off; the free path makes no network call' : 'telemetry on',
  })

  // Probe/adapter checks are contributed by the probe packages once they are
  // installed; the M0 gate deliberately runs with no debugger present.
  for (const extra of ctx.extraChecks ?? []) checks.push(extra)

  const failed = checks.some((c) => c.status === 'error')
  return {
    exitCode: failed ? EXIT.HARNESS : EXIT.ALLOW,
    text: [
      `witness doctor — ${failed ? 'PROBLEMS FOUND' : 'ok'}`,
      ...checks.map((c) => `  ${icon(c.status)} ${c.name.padEnd(12)} ${c.detail}${c.remedy ? `\n      → ${c.remedy}` : ''}`),
    ],
    json: { command: 'doctor', ok: !failed, checks },
  }
}

function icon(status: Check['status']): string {
  return status === 'ok' ? '✓' : status === 'warn' ? '!' : '✗'
}

export function binaryCheck(binary: string, args: string[]): Check {
  try {
    const out = execFileSync(binary, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return { name: binary, status: 'ok', detail: out.split('\n')[0]!.trim() }
  } catch {
    return { name: binary, status: 'error', detail: `${binary} not found on PATH`, remedy: `Install ${binary}.` }
  }
}
