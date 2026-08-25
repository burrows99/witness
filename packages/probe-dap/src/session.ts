import { connect, type Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { groupByFile, type ProbeTarget } from '@swe-verify/core'
import { DapClient, DapError, type DapClientOptions } from './client.js'
import { buildLogMessage, parseLogOutput } from './logpoint.js'
import { parseEvaluationError } from './evalerror.js'
import { toRemote, toRepoRelative, type PathMapping } from './pathmap.js'
import type { DapEvent } from './protocol.js'

/**
 * A DAP session that installs non-suspending logpoints and drains what they
 * emit. This is the `Probe` seam from contracts §7, for the `dap` probe.
 */

export interface InstalledProbe {
  id: string
  file: string
  line: number
  /**
   * DAP `Breakpoint.verified`. SV011 hinges on this: every adapter contract
   * test asserts it is true, not merely that `setBreakpoints` returned OK.
   */
  verified: boolean
  /** Where the adapter actually bound it, when it slid to the next statement. */
  adapterLine?: number
  message?: string
}

export interface ProbeDiagnostic {
  code: string
  severity: 'warn' | 'error'
  message: string
  file?: string
  line?: number
}

export interface ProbeHit {
  probeId: string
  vars: Record<string, unknown>
  /** Per-process monotonic time at receipt; the harness assigns `seq`. */
  monoNs: number
  wall: string
}

export interface SessionOptions extends DapClientOptions {
  /**
   * How long the attach/launch handshake may take. `dlv dap` compiles the
   * binary during `launch`, so on a real repository this is minutes, not the
   * seconds an ordinary request needs.
   */
  launchTimeoutMs?: number
  /** Repo root, used to record files repo-relative in the story. */
  repoRoot: string
  pathMapping?: PathMapping | null
  /** Extra text the adapter printed, kept for `harness.log`. */
  onOutput?: (text: string) => void
}

/** Generous by default: a cold Go build of a large package is minutes. */
const DEFAULT_LAUNCH_TIMEOUT_MS = 300_000

export class DapSession {
  private readonly hits: ProbeHit[] = []
  private readonly hitCounts = new Map<string, number>()
  private installed: InstalledProbe[] = []
  private terminated = false
  /**
   * `attach`/`launch` do not answer until `configurationDone` arrives: the
   * adapter is waiting for the client to finish configuring breakpoints. The
   * response is therefore held here and awaited at the end of the handshake —
   * awaiting it eagerly deadlocks, which is exactly what a naive reading of
   * the spec produces.
   */
  private pendingConfigure: Promise<unknown> | null = null
  private readonly targetsById = new Map<string, ProbeTarget>()
  private readonly diagnosticList: ProbeDiagnostic[] = []

  private constructor(
    readonly client: DapClient,
    private readonly options: SessionOptions,
    private readonly socket: Duplex | null,
  ) {}

  /**
   * Connect to a debuggee that is already listening (`debugpy --listen`,
   * `dlv dap --listen`). Attaching to a listening process, rather than
   * launching one, is what lets the application come up however the repo
   * normally brings it up.
   */
  static async connectTcp(host: string, port: number, options: SessionOptions & { connectTimeoutMs?: number }): Promise<DapSession> {
    const socket = await openSocket(host, port, options.connectTimeoutMs ?? 15_000)
    const session = new DapSession(
      new DapClient(socket, { ...options, onEvent: (event) => session.onEvent(event) }),
      options,
      socket,
    )
    return session
  }

  /** For tests and for adapters that speak DAP over an existing stream. */
  static overStream(stream: Duplex, options: SessionOptions): DapSession {
    const session = new DapSession(
      new DapClient(stream, { ...options, onEvent: (event) => session.onEvent(event) }),
      options,
      null,
    )
    return session
  }

  /**
   * The DAP handshake. `initialized` may arrive before or after the response
   * to `initialize` depending on the adapter, so the client latches it rather
   * than racing for it.
   */
  async initialize(clientName = 'swe-verify'): Promise<Record<string, unknown>> {
    const response = await this.client.request('initialize', {
      clientID: 'swe-verify',
      clientName,
      adapterID: 'swe-verify',
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsRunInTerminalRequest: false,
      locale: 'en',
    })
    return (response.body ?? {}) as Record<string, unknown>
  }

  async attach(args: Record<string, unknown>): Promise<void> {
    await this.configure('attach', args)
  }

  async launch(args: Record<string, unknown>): Promise<void> {
    await this.configure('launch', args)
  }

  private async configure(command: 'attach' | 'launch', args: Record<string, unknown>): Promise<void> {
    const initialized = this.client.waitFor('initialized', this.options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS)
    this.pendingConfigure = this.client.request(command, args, this.options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS)
    // Failures surface when the handshake completes; swallowing here only
    // stops Node treating it as an unhandled rejection in the meantime.
    this.pendingConfigure.catch(() => {})
    await initialized
  }

  /**
   * Install one logpoint per target. Grouped per file because DAP's
   * `setBreakpoints` is declarative per source: a second call for the same
   * file *replaces* the first, which is a classic way to lose half your
   * probes.
   */
  async install(targets: readonly ProbeTarget[]): Promise<InstalledProbe[]> {
    const installed: InstalledProbe[] = []
    for (const target of targets) this.targetsById.set(target.id, target)

    for (const [file, fileTargets] of groupByFile(targets)) {
      const sorted = [...fileTargets].sort((a, b) => a.line - b.line)
      const remotePath = toRemote(file, this.options.pathMapping ?? null, this.options.repoRoot)
      const response = await this.client.request('setBreakpoints', {
        source: { path: remotePath, name: file.split('/').pop() },
        breakpoints: sorted.map((t) => ({ line: t.line, logMessage: buildLogMessage(t) })),
        lines: sorted.map((t) => t.line),
      })

      const body = (response.body ?? {}) as { breakpoints?: Array<{ verified?: boolean; line?: number; message?: string }> }
      const results = body.breakpoints ?? []
      sorted.forEach((target, index) => {
        const result = results[index]
        const boundLine = result?.line
        installed.push({
          id: target.id,
          file,
          line: target.line,
          verified: result?.verified === true,
          // Adapters routinely slide a breakpoint to the next executable
          // statement. Recording both lines is what stops the requested line
          // reporting unfired forever (contracts §7).
          ...(boundLine !== undefined && boundLine !== target.line ? { adapterLine: boundLine } : {}),
          ...(result?.message ? { message: result.message } : {}),
        })
      })
    }

    this.installed = installed
    return installed
  }

  async configurationDone(): Promise<void> {
    try {
      await this.client.request('configurationDone')
    } catch (error) {
      // Not every adapter implements it; the capability flag is advisory and
      // some adapters answer with an error rather than a no-op.
      this.options.log?.(`dap: configurationDone not supported (${(error as Error).message})`)
    }
    if (this.pendingConfigure) {
      const pending = this.pendingConfigure
      this.pendingConfigure = null
      await pending
    }
  }

  /** Everything the probes emitted so far, in receipt order. */
  drain(): ProbeHit[] {
    return this.hits.splice(0, this.hits.length)
  }

  hitsFor(probeId: string): number {
    return this.hitCounts.get(probeId) ?? 0
  }

  /**
   * Every logpoint firing so far, across all probes.
   *
   * The number that explains a slow run. `budgets.probeLines` caps how many
   * lines are instrumented, but the cost is lines × executions: 97 probes on
   * a table-driven test with 55 cases is thousands of DAP round-trips, and
   * nothing counted them. A run died on a ten-minute budget with a remedy
   * suggesting the budget was too small, when what was actually happening
   * was a ninety-fold amplification nobody could see.
   */
  totalHits(): number {
    let total = 0
    for (const count of this.hitCounts.values()) total += count
    return total
  }

  get probes(): readonly InstalledProbe[] {
    return this.installed
  }

  /** Harness-level observations worth carrying into the story. */
  get diagnostics(): readonly ProbeDiagnostic[] {
    return this.diagnosticList
  }

  get exited(): boolean {
    return this.terminated
  }

  /** Wait until the debuggee exits, or the budget expires. */
  async waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.terminated) return true
    try {
      await this.client.waitFor('terminated', timeoutMs)
      return true
    } catch {
      return false
    }
  }

  async uninstall(): Promise<void> {
    try {
      // Clear the logpoints before leaving: an adapter that outlives the run
      // with probes still installed keeps writing into a sealed story.
      for (const file of new Set(this.installed.map((p) => p.file))) {
        await this.client.request('setBreakpoints', {
          source: { path: toRemote(file, this.options.pathMapping ?? null, this.options.repoRoot) },
          breakpoints: [],
        })
      }
    } catch { /* the adapter may already be gone; disconnecting still matters */ }

    try {
      await this.client.request('disconnect', { restart: false, terminateDebuggee: false })
    } catch (error) {
      if (!(error instanceof DapError)) throw error
    }
    this.client.close()
    this.socket?.destroy()
  }

  private onEvent(event: DapEvent): void {
    if (event.event === 'terminated' || event.event === 'exited') {
      this.terminated = true
      return
    }
    if (event.event !== 'output') return

    const body = (event.body ?? {}) as { output?: string; category?: string }
    const text = body.output ?? ''
    if (!text) return

    const hits = parseLogOutput(text, { all: true })
    if (hits.length === 0) {
      if (!this.recordEvaluationFailure(text)) this.options.onOutput?.(text)
      return
    }
    const wall = new Date().toISOString()
    for (const hit of hits) {
      this.hitCounts.set(hit.probeId, (this.hitCounts.get(hit.probeId) ?? 0) + 1)
      this.hits.push({ ...hit, monoNs: Number(process.hrtime.bigint()), wall })
    }
  }

  /**
   * An adapter error naming a symbol one probe asked for is that probe
   * firing, with its capture lost. Attribution has to be unambiguous: if two
   * probes wanted the same symbol, guessing which one ran would invent
   * coverage, so the ambiguity is reported instead.
   */
  private recordEvaluationFailure(text: string): boolean {
    const failure = parseEvaluationError(text)
    if (!failure) return false

    const candidates = this.installed.filter((probe) =>
      this.targetsById.get(probe.id)?.expressions.includes(failure.symbol))

    if (candidates.length === 1) {
      const probe = candidates[0]!
      this.hitCounts.set(probe.id, (this.hitCounts.get(probe.id) ?? 0) + 1)
      this.hits.push({
        probeId: probe.id,
        vars: { [failure.symbol]: `<unevaluable: ${failure.detail}>` },
        monoNs: Number(process.hrtime.bigint()),
        wall: new Date().toISOString(),
      })
      this.diagnosticList.push({
        code: 'SVH010',
        severity: 'warn',
        message: `probe ${probe.id} fired but could not capture "${failure.symbol}": ${failure.detail}`,
        file: probe.file,
        line: probe.line,
      })
      return true
    }

    if (candidates.length > 1) {
      this.diagnosticList.push({
        code: 'SVH011',
        severity: 'warn',
        message: `an expression for "${failure.symbol}" could not be evaluated, and ${candidates.length} probes requested it: the hit cannot be attributed (${failure.detail})`,
      })
      return true
    }
    return false
  }
}

export { toRepoRelative }

function openSocket(host: string, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const attempt = () => {
      const socket = connect({ host, port })
      socket.once('connect', () => resolve(socket))
      socket.once('error', (error) => {
        socket.destroy()
        // The debuggee may still be starting; retry until the budget is spent
        // rather than failing on the first refused connection.
        if (Date.now() - started > timeoutMs) {
          reject(new DapError(`could not connect to the debug adapter at ${host}:${port} within ${timeoutMs}ms (${error.message})`))
          return
        }
        setTimeout(attempt, 100).unref?.()
      })
    }
    attempt()
  })
}
