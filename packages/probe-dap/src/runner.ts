import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import type { Language, ProbeTarget } from '@swe-verify/core'
import { adapterFor, type AdapterSpec } from './adapters.js'
import { DapSession, type InstalledProbe, type ProbeDiagnostic, type ProbeHit } from './session.js'
import type { PathMapping } from './pathmap.js'

/**
 * Bring a debuggee up with probes installed, run it, and collect what fired.
 *
 * Ports are allocated by asking the OS for a free one rather than using a
 * fixed number. A fixed debug port collides the moment two jobs share a
 * runner, and the failure reads as a product bug rather than an
 * infrastructure one — hours of misdirected debugging, and a direct hit to
 * M5 (TDD §12.3).
 */

export interface ProbeRunOptions {
  language: Language
  /** Entry point, relative to `cwd`. */
  program: string
  cwd: string
  /** Root the story records paths against. */
  repoRoot: string
  /**
   * Where to look for the adapter itself — a project virtualenv or a
   * vendored DAP server. Defaults to `repoRoot`; they differ when the code
   * under test lives in a subdirectory of the project that owns the toolchain.
   */
  adapterRoot?: string
  targets: readonly ProbeTarget[]
  pathMapping?: PathMapping | null
  env?: Record<string, string | undefined>
  timeoutMs?: number
  log?: (line: string) => void
}

export interface ProbeRunResult {
  installed: InstalledProbe[]
  hits: ProbeHit[]
  hitsByProbe: Map<string, number>
  diagnostics: ProbeDiagnostic[]
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port ? resolve(port) : reject(new Error('could not allocate a port'))))
    })
  })
}

export async function runWithProbes(options: ProbeRunOptions): Promise<ProbeRunResult> {
  const spec: AdapterSpec = adapterFor(options.language)
  const adapterRoot = options.adapterRoot ?? options.repoRoot
  const availability = spec.detect(adapterRoot, options.env ?? process.env)
  if (!availability.available) {
    throw new Error(`no debug adapter for ${options.language}: ${availability.detail}${availability.remedy ? ` — ${availability.remedy}` : ''}`)
  }

  const port = await freePort()
  const params = {
    program: options.program,
    cwd: options.cwd,
    repoRoot: adapterRoot,
    port,
    pathMapping: options.pathMapping ?? null,
    env: options.env ?? process.env,
  }
  const command = spec.debuggee(params)

  let stdout = ''
  let stderr = ''
  const child: ChildProcess = spawn(command.command, command.args, {
    cwd: options.cwd,
    env: { ...process.env, ...command.env, ...options.env } as NodeJS.ProcessEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })

  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
  const timeoutMs = options.timeoutMs ?? 60_000

  let session: DapSession | null = null
  try {
    session = await DapSession.connectTcp('127.0.0.1', port, {
      repoRoot: options.repoRoot,
      pathMapping: options.pathMapping ?? null,
      ...(options.log ? { log: options.log } : {}),
      onOutput: (text) => { stdout += text },
      connectTimeoutMs: Math.min(timeoutMs, 20_000),
    })

    await session.initialize()
    if (spec.configure === 'attach') await session.attach(spec.configureArgs(params))
    else await session.launch(spec.configureArgs(params))

    const installed = await session.install(options.targets)
    await session.configurationDone()

    const finished = await Promise.race([
      exited.then(() => true),
      session.waitForExit(timeoutMs).then((done) => done),
    ])

    // The debuggee's last output can arrive after `terminated`; a story that
    // drops the final probe hit is a false block.
    await new Promise((resolve) => setTimeout(resolve, 150))

    const hits = session.drain()
    const hitsByProbe = new Map<string, number>()
    for (const probe of installed) hitsByProbe.set(probe.id, session.hitsFor(probe.id))

    return {
      installed,
      hits,
      hitsByProbe,
      diagnostics: [...session.diagnostics],
      stdout,
      stderr,
      exitCode: child.exitCode,
      timedOut: !finished,
    }
  } finally {
    try { await session?.uninstall() } catch { /* teardown is best-effort */ }
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM')
  }
}
