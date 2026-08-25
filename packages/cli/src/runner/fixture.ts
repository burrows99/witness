import { spawn, type ChildProcess } from 'node:child_process'
import { join, resolve } from 'node:path'
import type { PlanFixture, PlanReadyCheck } from '@swe-verify/core'
import { adapterFor, freePort, type AdapterSpec } from '@swe-verify/probe-dap'
import { HarnessError, UsageError } from '../errors.js'

/**
 * Fixture lifecycle.
 *
 * It lives in the plan, not in CI YAML: if CI knows how to bring the app up
 * and `local` does not, the two diverge and "`local` is the proof" quietly
 * stops being true (contracts §2).
 */

export interface FixtureHandle {
  /** Where the DAP client should connect, when the fixture is debuggable. */
  debug: { host: string; port: number } | null
  adapter: AdapterSpec | null
  baseUrl: string | undefined
  /** The port the application itself was told to listen on. */
  appPort: number | null
  /** Substitutes `{port}` in a plan string with the allocated app port. */
  substitute(text: string): string
  program: string
  cwd: string
  stdout(): string
  stderr(): string
  stop(): Promise<void>
}

export interface FixtureOptions {
  fixture: PlanFixture | undefined
  cwd: string
  repoRoot: string
  env: Record<string, string | undefined>
  log(line: string): void
}

interface ProcessFixture extends PlanFixture {
  language?: string
  program?: string
  baseUrl?: string
  attach?: { host?: string; port?: number }
}

export async function startFixture(options: FixtureOptions): Promise<FixtureHandle> {
  const fixture = (options.fixture ?? { kind: 'none' }) as ProcessFixture
  const cwd = fixture.file ? resolve(options.cwd, join(fixture.file, '..')) : options.cwd

  if (fixture.kind === 'compose') {
    throw new UsageError(
      'compose fixtures are not implemented in this build',
      'Use "kind": "process" to have swe-verify start the app under the debugger, or "kind": "none" with fixture.attach pointing at an already-listening debug port.',
    )
  }

  if (fixture.kind === 'none') {
    // The application is already up — brought up by compose, by the developer,
    // or not needed at all. Probes attach to a port that is already listening.
    const attach = fixture.attach
    return {
      debug: attach?.port ? { host: attach.host ?? '127.0.0.1', port: attach.port } : null,
      adapter: fixture.language ? adapterFor(fixture.language as never) : null,
      baseUrl: fixture.baseUrl,
      appPort: null,
      substitute: (text: string) => text,
      program: fixture.program ?? '',
      cwd: options.cwd,
      stdout: () => '',
      stderr: () => '',
      stop: async () => {},
    }
  }

  if (!fixture.language || !fixture.program) {
    throw new UsageError(
      'a "process" fixture needs both "language" and "program"',
      'For example: { "kind": "process", "language": "py", "program": "app.py" }.',
    )
  }

  const adapter = adapterFor(fixture.language as never)
  const availability = adapter.detect(options.repoRoot, options.env)
  if (!availability.available) {
    // Refuse rather than degrade (NFR-12, D3). This is a config problem the
    // developer can fix, so it is exit 3, not a harness crash.
    throw new UsageError(
      `no debug adapter available for ${fixture.language}: ${availability.detail}`,
      availability.remedy ?? 'Install the adapter for this language, or exclude these paths from the gate.',
    )
  }

  const port = await freePort()
  // The application's own port is allocated too. A fixed port collides the
  // moment two jobs share a runner, and the failure reads as a product bug
  // rather than an infrastructure one (TDD §12.3).
  const appPort = await freePort()
  const substitute = (text: string) => text.replaceAll('{port}', String(appPort))

  const command = adapter.debuggee({
    program: fixture.program,
    cwd,
    repoRoot: options.repoRoot,
    port,
    pathMapping: null,
    env: options.env,
  })

  let stdout = ''
  let stderr = ''
  const child: ChildProcess = spawn(command.command, command.args, {
    cwd,
    env: {
      ...options.env,
      ...command.env,
      PORT: String(appPort),
      SWE_VERIFY_APP_PORT: String(appPort),
      ...fixture.env,
    } as NodeJS.ProcessEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  child.on('error', (error) => { stderr += `\n${error.message}` })
  options.log(`fixture: ${command.command} ${command.args.join(' ')} (debug port ${port}, app port ${appPort})`)

  return {
    debug: { host: '127.0.0.1', port },
    adapter,
    baseUrl: fixture.baseUrl ? substitute(fixture.baseUrl) : `http://127.0.0.1:${appPort}`,
    appPort,
    substitute,
    program: fixture.program,
    cwd,
    stdout: () => stdout,
    stderr: () => stderr,
    stop: async () => {
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGTERM')
        // A fixture that ignores SIGTERM must not hold the run open (NFR-11).
        await Promise.race([
          new Promise<void>((r) => child.once('exit', () => r())),
          new Promise<void>((r) => setTimeout(() => { child.kill('SIGKILL'); r() }, 5_000).unref?.()),
        ])
      }
    },
  }
}

/**
 * Readiness, not a sleep. "Fixture never becomes ready" is a harness failure
 * (exit 4) with the logs retained — never a verdict about the change.
 */
export async function waitForReady(checks: PlanReadyCheck[] | undefined, log: (line: string) => void): Promise<void> {
  for (const check of checks ?? []) {
    if (!check.http) continue
    const timeoutMs = check.timeoutMs ?? 60_000
    const expected = check.status ?? 200
    const started = Date.now()
    for (;;) {
      try {
        const response = await fetch(check.http, { signal: AbortSignal.timeout(2_000) })
        if (response.status === expected) { log(`fixture ready: ${check.http}`); break }
      } catch { /* not up yet */ }
      if (Date.now() - started > timeoutMs) {
        throw new HarnessError(
          `fixture never became ready: ${check.http} did not return ${expected} within ${timeoutMs}ms`,
          'Check the fixture command and its logs in logs/harness.log; raise the readiness timeout if the app is genuinely slow to start.',
        )
      }
      await new Promise((r) => setTimeout(r, 250))
    }
  }
}
