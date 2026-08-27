import type { Duplex } from 'node:stream'
import { MessageDecoder, encodeMessage, type DapEvent, type DapMessage, type DapResponse } from './protocol.js'

/**
 * A DAP client: request/response correlation, event fan-out, and timeouts.
 *
 * Every failure here is a *harness* failure — "we could not observe" — with
 * one exception, an accepted-but-unverified breakpoint, which is a verdict
 * because the developer's path mapping is the cause and the developer is the
 * one who can fix it (TDD §10.4).
 */

/** One-shot lifecycle events, which a late waiter must still observe. */
const LATCHED_EVENTS = new Set(['initialized', 'terminated', 'exited'])

export class DapError extends Error {
  constructor(message: string, readonly command?: string) {
    super(message)
    this.name = 'DapError'
  }
}

export interface DapClientOptions {
  /** Per-request timeout. A hung adapter must never hang a run (NFR-11). */
  timeoutMs?: number
  onEvent?: (event: DapEvent) => void
  log?: (line: string) => void
  /**
   * Answer a reverse request from the adapter. Return true when handled, so
   * the client acknowledges it; false leaves the existing refusal in place.
   *
   * js-debug needs this. It is multi-session: the connection you launch on
   * never runs your code, it sends `startDebugging` asking the client to open
   * a *second* connection for the actual process. Refusing that is why
   * breakpoints hit nothing and `terminated` never arrives.
   */
  onReverseRequest?: (command: string, args: Record<string, unknown>) => boolean
}

interface Pending {
  resolve: (response: DapResponse) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
  command: string
}

export class DapClient {
  private seq = 1
  private readonly pending = new Map<number, Pending>()
  private readonly waiters = new Map<string, Array<(event: DapEvent) => void>>()
  /**
   * Some adapters send `initialized` straight after the initialize response;
   * others withhold it until attach/launch. Both are legal, so one-shot
   * events are latched: a waiter registered after the fact still resolves,
   * instead of hanging until the timeout.
   */
  private readonly latched = new Map<string, DapEvent>()
  private readonly decoder: MessageDecoder
  private closed = false
  private closeReason: Error | null = null

  constructor(private readonly stream: Duplex, private readonly options: DapClientOptions = {}) {
    this.decoder = new MessageDecoder(
      (message) => { this.dispatch(message); },
      (error, raw) => this.options.log?.(`dap: undecodable message (${error.message}): ${raw.slice(0, 200)}`),
    )
    stream.on('data', (chunk: Buffer) => { this.decoder.push(chunk); })
    stream.on('error', (error: Error) => { this.fail(error); })
    stream.on('close', () => { this.fail(new DapError('adapter connection closed')); })
  }

  get timeoutMs(): number {
    return this.options.timeoutMs ?? 15_000
  }

  request(command: string, args?: unknown, timeoutMs = this.timeoutMs): Promise<DapResponse> {
    if (this.closed) return Promise.reject(this.closeReason ?? new DapError('adapter connection closed', command))
    const seq = this.seq++
    const message = { seq, type: 'request', command, ...(args === undefined ? {} : { arguments: args }) }
    this.options.log?.(`dap → ${command} ${JSON.stringify(args ?? {}).slice(0, 400)}`)

    return new Promise<DapResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq)
        reject(new DapError(`timed out after ${timeoutMs}ms waiting for "${command}"`, command))
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(seq, { resolve, reject, timer, command })
      this.stream.write(encodeMessage(message))
    })
  }

  /** Resolves when `event` arrives, or immediately if it already has. */
  waitFor(event: string, timeoutMs = this.timeoutMs): Promise<DapEvent> {
    const already = this.latched.get(event)
    if (already) return Promise.resolve(already)
    return new Promise<DapEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.set(event, (this.waiters.get(event) ?? []).filter((h) => h !== handler))
        reject(new DapError(`timed out after ${timeoutMs}ms waiting for the "${event}" event`))
      }, timeoutMs)
      timer.unref?.()
      const handler = (e: DapEvent) => { clearTimeout(timer); resolve(e) }
      const existing = this.waiters.get(event)
      if (existing) existing.push(handler)
      else this.waiters.set(event, [handler])
    })
  }

  close(): void {
    this.fail(new DapError('client closed'))
    this.stream.end()
  }

  private dispatch(message: DapMessage): void {
    if (message.type === 'response') {
      const response = message as DapResponse
      const pending = this.pending.get(response.request_seq)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(response.request_seq)
      this.options.log?.(`dap ← ${response.command} success=${response.success}`)
      if (response.success) pending.resolve(response)
      else pending.reject(new DapError(response.message ?? `adapter rejected "${response.command}"`, response.command))
      return
    }

    if (message.type === 'event') {
      const event = message as DapEvent
      this.options.log?.(`dap ← event ${event.event}`)
      if (LATCHED_EVENTS.has(event.event)) this.latched.set(event.event, event)
      this.options.onEvent?.(event)
      const waiters = this.waiters.get(event.event)
      if (waiters?.length) {
        this.waiters.set(event.event, [])
        for (const handler of waiters) handler(event)
      }
      return
    }

    // A reverse request (`runInTerminal`) is answered with a refusal rather
    // than ignored: an adapter that waits forever for a reply hangs the run.
    if (message.type === 'request') {
      const command = typeof message.command === 'string' ? message.command : ''
      const args = (message.arguments ?? {}) as Record<string, unknown>
      this.options.log?.(`dap ← request ${command}`)
      const handled = this.options.onReverseRequest?.(command, args) === true
      this.stream.write(encodeMessage({
        seq: this.seq++,
        type: 'response',
        request_seq: message.seq,
        success: handled,
        command,
        ...(handled ? {} : { message: 'witness runs headless and cannot host a terminal' }),
      }))
    }
  }

  private fail(error: Error): void {
    if (this.closed) return
    this.closed = true
    this.closeReason = error
    for (const [seq, pending] of this.pending) {
      clearTimeout(pending.timer)
      this.pending.delete(seq)
      pending.reject(error)
    }
  }
}
