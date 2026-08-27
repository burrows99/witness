import { existsSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { join, resolve } from 'node:path'
import type { PlanFixture, PlanReadyCheck } from '../../core/index.js'
import { adapterFor, freePort, type AdapterSpec } from '../../probe-dap/index.js'
import { brandEnvName, resolveBrand } from '../../core/index.js'
import { HarnessError, UsageError } from '../errors.js'
import {
  composeCommand, composeDown, composeLogs, composeUp, publishedPort, resolveComposeUrl,
  type ComposeTarget,
} from './compose.js'

/**
 * Fixture lifecycle.
 *
 * It lives in the plan, not in CI YAML: if CI knows how to bring the app up
 * and `local` does not, the two diverge and "`local` is the proof" quietly
 * stops being true (contracts §2).
 */

export interface FixtureHandle {
  /** Launch mode and arguments the plan asked for, forwarded to the adapter. */
  mode: string | undefined
  args: string[] | undefined
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
  /** Namespaces a compose project so concurrent runs cannot collide. */
  runId?: string
  /** How long a stack may take to come up; images may need building. */
  composeTimeoutMs?: number
}

export async function startFixture(options: FixtureOptions): Promise<FixtureHandle> {
  const fixture: PlanFixture = options.fixture ?? { kind: 'none' }
  const cwd = fixture.file ? resolve(options.cwd, join(fixture.file, '..')) : options.cwd

  if (fixture.kind === 'compose') {
    return await startCompose(fixture, options, cwd)
  }

  if (fixture.kind === 'none') {
    // The application is already up — brought up by compose, by the developer,
    // or not needed at all. Probes attach to a port that is already listening.
    const attach = fixture.attach
    return {
      debug: attach?.port ? { host: attach.host ?? '127.0.0.1', port: attach.port } : null,
      adapter: fixture.language ? adapterFor(fixture.language as never) : null,
      baseUrl: fixture.baseUrl,
      mode: fixture.mode,
      args: fixture.args,
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
  // Without an adapter the app still runs, it is just not watched. Refusing to
  // start it at all conflated two different things: witness cannot *gate*
  // this language, and witness cannot *run* this app. Only the first is
  // true, and treating them as one meant a Node app could not have its
  // lifecycle managed by the harness at all — two agents independently ended
  // up starting the server by hand and pointing a `kind: "none"` fixture at
  // it, which is a worse plan for the same run. The changed lines report
  // SV016, ungated and honest, exactly as they would have anyway.
  const debuggable = availability.available
  if (!debuggable) {
    options.log(
      `fixture: no debug adapter for ${fixture.language} (${availability.detail}) — starting the app unwatched; its changed lines will report SV016`,
    )
  }

  // `file` decides the working directory and `program` is resolved inside it,
  // so naming the same repo-relative path in both doubles the prefix. Two
  // agents lost a run each to that: the debuggee died with "Cannot find
  // module .../examples/app/examples/app/index.js", which surfaced as
  // "fixture never became ready" — a harness failure whose real cause was
  // only in the log. Checking here turns it into a usage error that names
  // exactly what was tried.
  if (looksLikePath(fixture.program)) {
    const resolved = resolve(cwd, fixture.program)
    if (!existsSync(resolved)) {
      const fromRoot = resolve(options.cwd, fixture.program)
      throw new UsageError(
        `fixture.program "${fixture.program}" does not exist at ${resolved}`,
        existsSync(fromRoot)
          ? `It exists at ${fromRoot}. "program" is resolved inside the directory holding "file" (${cwd}), so name it relative to that — usually just the basename.`
          : `"program" is resolved inside the directory holding "file" (${cwd}). Check the path, or drop "file" to resolve from the repository root.`,
      )
    }
  }

  const port = await freePort()
  // The application's own port is allocated too. A fixed port collides the
  // moment two jobs share a runner, and the failure reads as a product bug
  // rather than an infrastructure one (TDD §12.3).
  const appPort = await freePort()
  const substitute = (text: string) => text.replaceAll('{port}', String(appPort))

  const command = debuggable
    ? adapter.debuggee({
        program: fixture.program,
        cwd,
        repoRoot: options.repoRoot,
        port,
        pathMapping: null,
        env: options.env,
      })
    : adapter.plain({ program: fixture.program, cwd, args: fixture.args ?? [], env: options.env })

  // No guard on `command` here: `plain` is required of every adapter, and the
  // unavailable-adapter case is already handled above — it logs, clears
  // `debuggable`, and lets the app start unwatched so the run reports SV016
  // rather than dying. A `!command` throw here was reachable only when `plain`
  // was optional, and had been dead since it stopped being.

  let stdout = ''
  let stderr = ''
  const child: ChildProcess = spawn(command.command, command.args, {
    cwd,
    env: {
      ...options.env,
      ...command.env,
      PORT: String(appPort),
      [brandEnvName('APP_PORT', resolveBrand(options.env))]: String(appPort),
      // The default name too, so a fixture written before a rename keeps working.
      WITNESS_APP_PORT: String(appPort),
      ...fixture.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  child.on('error', (error) => { stderr += `\n${error.message}` })
  options.log(
    `fixture: ${command.command} ${command.args.join(' ')} (${debuggable ? `debug port ${port}, ` : 'unwatched, '}app port ${appPort})`,
  )

  return {
    debug: debuggable ? { host: '127.0.0.1', port } : null,
    adapter: debuggable ? adapter : null,
    baseUrl: fixture.baseUrl ? substitute(fixture.baseUrl) : `http://127.0.0.1:${appPort}`,
    mode: fixture.mode,
    args: fixture.args,
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
          new Promise<void>((r) => child.once('exit', () => { r(); })),
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


/**
 * A compose stack: several services, a database, and an application that is
 * only usable once all of them are serving.
 *
 * The project name carries the run id so two runs cannot collide on a
 * container or network name, and teardown removes volumes — a database that
 * survives a run is how the next one passes for the wrong reason.
 */
async function startCompose(
  fixture: PlanFixture,
  options: FixtureOptions,
  cwd: string,
): Promise<FixtureHandle> {
  if (!fixture.file) {
    throw new UsageError(
      'a "compose" fixture needs "file" pointing at a compose file',
      'Set fixture.file to the docker-compose.yml that brings this app up.',
    )
  }
  const command = composeCommand()
  if (!command) {
    // A harness failure, not the change's fault: nothing about the diff can
    // fix a machine with no Docker on it.
    throw new HarnessError(
      'this plan needs Docker Compose, and neither `docker compose` nor `docker-compose` is available',
      'Install Docker Desktop or the compose plugin, or rewrite the plan to use "kind": "process".',
    )
  }

  const target: ComposeTarget = {
    file: fixture.file,
    project: `witness-${(options.runId ?? 'local').slice(-10).toLowerCase()}`,
    ...(fixture.build ? { build: true } : {}),
  }
  options.log(`fixture: compose up -p ${target.project} -f ${target.file}`)

  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    // Teardown runs even when bring-up failed: a partially-created stack
    // still holds a network and containers that would break the next run.
    try {
      await composeDown(command, target, options.cwd)
      options.log(`fixture: compose down -p ${target.project}`)
    } catch (error) {
      options.log(`fixture: compose down failed, containers may be left behind: ${(error as Error).message}`)
    }
  }

  try {
    await composeUp(command, target, options.cwd, options.composeTimeoutMs ?? 600_000)
  } catch (error) {
    const logs = await composeLogs(command, target, options.cwd)
    await stop()
    if (logs) options.log(`fixture: compose logs (last 40 lines)\n${logs.split('\n').slice(-40).join('\n')}`)
    throw new HarnessError(
      `the compose stack never came up: ${(error as Error).message}`,
      'Check the compose file and the service logs in the harness log; this is a fixture problem, not a coverage one.',
    )
  }

  // Compose may map the container port onto an ephemeral host port, which
  // the plan cannot know in advance.
  let port: number | null = null
  if (fixture.service && fixture.port) {
    port = await publishedPort(command, target, fixture.service, fixture.port, options.cwd)
    if (port !== null) options.log(`fixture: ${fixture.service}:${fixture.port} published on ${port}`)
  }

  const attach = fixture.attach
  return {
    debug: attach?.port ? { host: attach.host ?? '127.0.0.1', port: attach.port } : null,
    adapter: fixture.language ? adapterFor(fixture.language as never) : null,
    baseUrl: resolveComposeUrl(fixture.baseUrl, port),
    mode: fixture.mode,
    args: fixture.args,
    appPort: port,
    substitute: (text: string) => (port === null ? text : text.replace(/\{port\}/g, String(port))),
    program: fixture.program ?? '',
    cwd,
    stdout: () => '',
    stderr: () => '',
    stop,
  }
}


/**
 * Whether `program` names a file rather than a package or module spec.
 *
 * Go takes `.` or `./pkg/...`, Java takes a class name; neither is a path on
 * disk to check. Only something with a file extension is worth resolving.
 */
function looksLikePath(program: string | undefined): program is string {
  return typeof program === 'string' && /\.[cm]?[jt]sx?$|\.py$|\.jar$/.test(program)
}
