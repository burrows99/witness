import { connect, type Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { groupByFile, type ProbeTarget } from '../core/index.js'
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
  /**
   * The adapter's own id for this breakpoint. Needed because verification can
   * arrive after acceptance: js-debug answers `setBreakpoints` before the
   * script has loaded, then sends a `breakpoint` event once it has, and the
   * id is the only way to match that back to a probe.
   */
  adapterId?: number
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
  /**
   * Where to reconnect for a child session, when the adapter is
   * multi-session. js-debug launches nothing on the connection you speak to:
   * it sends a `startDebugging` reverse request naming a target, and the
   * process only exists on a second connection to the same server. Probes set
   * before that follow-through land on a session that runs no code.
   */
  followChildAt?: { host: string; port: number }
  /** Repo root, used to record files repo-relative in the story. */
  repoRoot: string
  pathMapping?: PathMapping | null
  /** Extra text the adapter printed, kept for `harness.log`. */
  onOutput?: (text: string) => void
}

/** The same handshake for a parent connection and for any child it spawns. */
const INITIALIZE_ARGS: Record<string, unknown> = {
  clientID: 'witness',
  clientName: 'witness',
  adapterID: 'witness',
  pathFormat: 'path',
  linesStartAt1: true,
  columnsStartAt1: true,
  supportsVariableType: true,
  supportsRunInTerminalRequest: false,
  supportsStartDebuggingRequest: true,
  locale: 'en',
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
  /** The child session an adapter asked us to open, once it has asked. */
  private pendingChild: { request: string; configuration: Record<string, unknown> } | null = null
  private childArrived: (() => void) | null = null
  /** Kept open deliberately: closing the parent tears the child down with it. */
  private parentClient: DapClient | null = null
  private childSocket: Duplex | null = null
  /** Every child being watched, so probes reach the one that runs the code. */
  private readonly followed: DapClient[] = []
  private readonly extraSockets: Duplex[] = []
  /** What install() sent, replayed onto a child that appears afterwards. */
  private readonly breakpointRequests: Array<Record<string, unknown>> = []
  private readonly targetsById = new Map<string, ProbeTarget>()
  private readonly diagnosticList: ProbeDiagnostic[] = []

  private constructor(
    private client: DapClient,
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
    const session: DapSession = new DapSession(
      new DapClient(socket, {
        ...options,
        onEvent: (event) => session.onEvent(event),
        onReverseRequest: (command, args): boolean => session.onReverseRequest(command, args),
      }),
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
  async initialize(clientName = 'witness'): Promise<Record<string, unknown>> {
    const response = await this.client.request('initialize', { ...INITIALIZE_ARGS, clientName })
    return (response.body ?? {}) as Record<string, unknown>
  }

  async attach(args: Record<string, unknown>): Promise<void> {
    await this.configure('attach', args)
  }

  async launch(args: Record<string, unknown>): Promise<void> {
    await this.configure('launch', args)
  }

  /**
   * A `startDebugging` request means the real process lives on another
   * connection. Capturing the configuration here — and acknowledging it, so
   * the adapter does not sit waiting — is what lets `configure` follow it.
   */
  private onReverseRequest(command: string, args: Record<string, unknown>): boolean {
    if (command !== 'startDebugging') return false
    const configuration = (args.configuration ?? {}) as Record<string, unknown>
    // Typed, not stringified: `args` is whatever the adapter sent, and
    // String() on an object yields "[object Object]" as a request command.
    const request = typeof args.request === 'string' ? args.request : 'launch'
    const child = { request, configuration }

    // Every announcement, not only the first. A test runner that forks — mocha
    // does — produces one child for the runner and another for the process
    // that actually runs the tests. Following only the first attached to the
    // wrong one: no probe ever verified, no output ever arrived, and the run
    // sat until its budget killed it.
    if (!this.pendingChild) {
      this.pendingChild = child
      this.childArrived?.()
    } else {
      void this.adoptLaterChild(child)
    }
    return true
  }

  /**
   * Move this session onto the child the adapter just announced.
   *
   * The parent connection stays open: closing it tears the child down with
   * it. Everything after this — probes, hits, `terminated` — belongs to the
   * child, which is the only session where the program actually runs.
   */
  private async followChild(at: { host: string; port: number }): Promise<void> {
    if (!this.pendingChild) {
      await new Promise<void>((resolve) => {
        if (this.pendingChild) return resolve()
        this.childArrived = resolve
        setTimeout(resolve, 15_000)
      })
    }
    const child = this.pendingChild
    if (!child) {
      this.options.log?.('dap: adapter never announced a child session; probes would land on a session that runs nothing')
      return
    }

    const socket = await openSocket(at.host, at.port, 15_000)
    this.parentClient = this.client
    this.client = new DapClient(socket, {
      ...this.options,
      onEvent: (event) => this.onEvent(event),
      onReverseRequest: (command, args) => this.onReverseRequest(command, args),
    })
    this.childSocket = socket
    this.followed.push(this.client)
    await this.client.request('initialize', INITIALIZE_ARGS, this.options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS)
    const started = this.client.waitFor('initialized', this.options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS)
    // Left pending on purpose. The child withholds its launch response until
    // its own configurationDone, just as the parent did — awaiting it here
    // would deadlock before a single probe was installed. The caller's
    // configurationDone() is what releases it.
    this.pendingConfigure = this.client.request(
      child.request,
      child.configuration,
      this.options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS,
    )
    this.pendingConfigure.catch(() => {})
    await started
    this.options.log?.('dap: following the adapter to its child session')
  }

  /**
   * Attach to a child announced after the first, and give it the probes that
   * are already installed. Until it has them it is running the code we care
   * about while watching nothing.
   */
  private async adoptLaterChild(child: { request: string; configuration: Record<string, unknown> }): Promise<void> {
    const at = this.options.followChildAt
    if (!at) return
    try {
      const socket = await openSocket(at.host, at.port, 15_000)
      this.extraSockets.push(socket)
      const client = new DapClient(socket, {
        ...this.options,
        onEvent: (event) => this.onEvent(event),
        onReverseRequest: (command, args) => this.onReverseRequest(command, args),
      })
      this.followed.push(client)
      await client.request('initialize', INITIALIZE_ARGS, this.options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS)
      const started = client.waitFor('initialized', this.options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS)
      const launched = client.request(child.request, child.configuration, this.options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS)
      launched.catch(() => {})
      await started
      for (const request of this.breakpointRequests) {
        await client.request('setBreakpoints', request).catch(() => {})
      }
      await client.request('configurationDone').catch(() => {})
      this.options.log?.(`dap: adopted a further child session (${this.followed.length} in total)`)
    } catch (error) {
      this.options.log?.(`dap: could not adopt a further child session: ${(error as Error).message}`)
    }
  }

  private async configure(command: 'attach' | 'launch', args: Record<string, unknown>): Promise<void> {
    const initialized = this.client.waitFor('initialized', this.options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS)
    this.pendingConfigure = this.client.request(command, args, this.options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS)
    // Failures surface when the handshake completes; swallowing here only
    // stops Node treating it as an unhandled rejection in the meantime.
    this.pendingConfigure.catch(() => {})
    await initialized

    // A multi-session adapter has not started the program yet, and it will
    // not until the parent handshake finishes: js-debug withholds the launch
    // response until `configurationDone`, exactly as debugpy withholds
    // `attach`. So the parent's handshake is completed here rather than by
    // the caller — by the time this returns, `client` is the child, and the
    // caller's install() and configurationDone() land on the session that
    // actually runs the program.
    if (this.options.followChildAt) {
      try {
        await this.client.request('configurationDone')
      } catch (error) {
        this.options.log?.(`dap: parent configurationDone refused (${(error as Error).message})`)
      }
      await this.pendingConfigure
      await this.followChild(this.options.followChildAt)
    }
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
      const request = {
        source: { path: remotePath, name: file.split('/').pop() },
        breakpoints: sorted.map((t) => ({ line: t.line, logMessage: buildLogMessage(t) })),
        lines: sorted.map((t) => t.line),
      }
      // Kept so a child announced later gets the same probes. Without it, a
      // forked test process runs the code while watching nothing.
      this.breakpointRequests.push(request)
      const response = await this.client.request('setBreakpoints', request)
      // Fan out to any sibling already being followed. `this.client` is only
      // the first child; a runner that forks has more, and the code usually
      // runs in one of the others.
      for (const sibling of this.followed) {
        if (sibling === this.client) continue
        await sibling.request('setBreakpoints', request).catch(() => {})
      }

      const body = (response.body ?? {}) as { breakpoints?: Array<{ id?: number; verified?: boolean; line?: number; message?: string }> }
      const results = body.breakpoints ?? []
      sorted.forEach((target, index) => {
        const result = results[index]
        const boundLine = result?.line
        installed.push({
          id: target.id,
          file,
          line: target.line,
          verified: result?.verified === true,
          // The adapter's own id for this breakpoint, so a later `breakpoint`
          // event can be matched back to the probe it verifies.
          ...(result?.id !== undefined ? { adapterId: result.id } : {}),
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

    // An adapter may verify a breakpoint later than it accepts one. js-debug
    // answers `setBreakpoints` before the script has loaded, so every probe
    // comes back unverified and only becomes real when the file arrives —
    // reported as a `breakpoint` event. Without this every JavaScript line
    // reports SV011, "accepted but never verified", on a run whose logpoints
    // demonstrably fired.
    if (event.event === 'breakpoint') {
      const body = (event.body ?? {}) as { breakpoint?: { id?: number; verified?: boolean; line?: number; message?: string } }
      const update = body.breakpoint
      if (update?.id === undefined) return
      const probe = this.installed.find((p) => p.adapterId === update.id)
      if (!probe) return
      if (update.verified === true) probe.verified = true
      if (update.line !== undefined) probe.adapterLine = update.line
      if (update.message) probe.message = update.message
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
