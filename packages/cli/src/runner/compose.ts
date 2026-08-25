import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'

/**
 * Compose fixtures — bringing a real stack up.
 *
 * A `process` fixture starts one program under a debugger, which covers a
 * library or a test binary. It does not cover an application: real ones come
 * up as several services with a database behind them. Without this, a change
 * whose evidence should be "here is the app working" could only ever be
 * filmed as a test run — which proves the code executed, not that anybody
 * could use the result.
 *
 * The lifecycle is the whole difficulty. A stack left running poisons the
 * next run with stale state; one torn down without its volumes leaves a
 * database that makes the following run pass for the wrong reason.
 */

const run = promisify(execFile)

export interface ComposeCommand {
  file: string
  prefix: string[]
}

export interface ComposeTarget {
  file: string
  /** Isolates this run's containers and network from every other run. */
  project: string
  build?: boolean
}

/** Whether a command exists, injected so the choice can be tested. */
export type HasCommand = (command: string) => boolean

function hasCommand(command: string, probe: string[] = ['--version']): boolean {
  try {
    execFileSync(command, probe, { stdio: ['ignore', 'ignore', 'ignore'], timeout: 15_000 })
    return true
  } catch {
    return false
  }
}

/**
 * `docker compose` is the current form; `docker-compose` is the standalone
 * binary that still ships on plenty of machines. Choosing at run time rather
 * than requiring one keeps a plan portable between them.
 */
export function composeCommand(has: HasCommand = (cmd) => hasCommand(cmd)): ComposeCommand | null {
  if (has('docker')) return { file: 'docker', prefix: ['compose'] }
  if (has('docker-compose')) return { file: 'docker-compose', prefix: [] }
  return null
}

export function composeArgs(target: ComposeTarget): string[] {
  return [
    '-f', target.file,
    '-p', target.project,
    'up', '-d',
    // `up -d` alone returns once containers are *created*. A plan that starts
    // driving then is racing its own fixture, and the failure looks like a
    // flaky application rather than a fixture that was not up.
    '--wait',
    ...(target.build ? ['--build'] : []),
  ]
}

export function composeDownArgs(target: ComposeTarget): string[] {
  return ['-f', target.file, '-p', target.project, 'down', '-v', '--remove-orphans']
}

/** Compose may publish a container port on an ephemeral host port. */
export function resolveComposeUrl(baseUrl: string | undefined, port: number | null): string | undefined {
  if (!baseUrl) return undefined
  if (!baseUrl.includes('{port}')) return baseUrl
  // A visibly wrong URL beats a silently plausible one: leaving the
  // placeholder makes the failure name its own cause.
  if (port === null) return baseUrl
  return baseUrl.replace('{port}', String(port))
}

/** The host port compose published for a service's container port. */
export async function publishedPort(
  command: ComposeCommand,
  target: ComposeTarget,
  service: string,
  containerPort: number,
  cwd: string,
): Promise<number | null> {
  try {
    const { stdout } = await run(
      command.file,
      [...command.prefix, '-f', target.file, '-p', target.project, 'port', service, String(containerPort)],
      { cwd, timeout: 60_000 },
    )
    const match = /:(\d+)\s*$/.exec(stdout.trim())
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}

export async function composeUp(command: ComposeCommand, target: ComposeTarget, cwd: string, timeoutMs: number): Promise<void> {
  await run(command.file, [...command.prefix, ...composeArgs(target)], { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 })
}

export async function composeDown(command: ComposeCommand, target: ComposeTarget, cwd: string): Promise<void> {
  await run(command.file, [...command.prefix, ...composeDownArgs(target)], { cwd, timeout: 180_000, maxBuffer: 32 * 1024 * 1024 })
}

export async function composeLogs(command: ComposeCommand, target: ComposeTarget, cwd: string): Promise<string> {
  try {
    const { stdout, stderr } = await run(
      command.file,
      [...command.prefix, '-f', target.file, '-p', target.project, 'logs', '--no-color', '--tail', '200'],
      { cwd, timeout: 60_000, maxBuffer: 32 * 1024 * 1024 },
    )
    return `${stdout}${stderr}`
  } catch {
    return ''
  }
}
