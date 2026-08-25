import { Duplex } from 'node:stream'
import { MessageDecoder, encodeMessage, type DapMessage } from '../../src/protocol.js'
import { LOGPOINT_MAGIC, FIELD_SEPARATOR } from '../../src/logpoint.js'

/**
 * A protocol-conformant DAP adapter, in process.
 *
 * Real adapters are exercised in the adapter-contract suite. This one exists
 * to provoke the behaviours real adapters make slow or impossible to trigger
 * on demand: an unverified breakpoint, a slid line, a silent adapter, a
 * reverse request, a crash mid-session.
 */

export interface FakeAdapterOptions {
  verify?: boolean
  verifyMessage?: string
  slideTo?: number
  /** Never answer anything — provokes the client's timeout path. */
  silent?: boolean
  /** Withhold the attach response until configurationDone, as debugpy does. */
  deferAttachResponse?: boolean
}

interface RecordedBreakpoint {
  line: number
  logMessage?: string
}

export class FakeAdapter {
  readonly clientStream: Duplex
  readonly commands: string[] = []
  readonly reverseResponses: Array<{ success: boolean; command: string }> = []
  setBreakpointCalls = 0

  private readonly sources = new Map<string, RecordedBreakpoint[]>()
  private seq = 1
  private deferredAttach: number | null = null

  constructor(private readonly options: FakeAdapterOptions = {}) {
    const decoder = new MessageDecoder((message) => this.handle(message))
    // A hand-rolled Duplex rather than a PassThrough pair: what the client
    // writes must arrive at the adapter, and what the adapter pushes must
    // arrive at the client, on one stream object.
    this.clientStream = new Duplex({
      write: (chunk: Buffer, _encoding, callback) => { decoder.push(chunk); callback() },
      read: () => {},
    })
  }

  breakpointsFor(path: string): RecordedBreakpoint[] {
    return this.sources.get(path) ?? []
  }

  /** Emit the output a logpoint would produce, with values already resolved. */
  fire(probeId: string, vars: Record<string, string>): void {
    const parts = [LOGPOINT_MAGIC, probeId]
    for (const [name, value] of Object.entries(vars)) parts.push(name, value)
    this.output(`${parts.join(FIELD_SEPARATOR)}\n`)
  }

  output(text: string): void {
    this.send({ type: 'event', event: 'output', body: { category: 'console', output: text } })
  }

  sendReverseRequest(command: string): void {
    this.send({ type: 'request', command, arguments: {} })
  }

  crash(): void {
    this.clientStream.destroy()
  }

  private handle(message: DapMessage): void {
    if (message.type === 'response') {
      this.reverseResponses.push({ success: message.success as boolean, command: message.command as string })
      return
    }
    if (message.type !== 'request') return

    const command = String(message.command)
    this.commands.push(command)
    if (this.options.silent) return

    switch (command) {
      case 'initialize':
        this.respond(message, { supportsLogPoints: true, supportsConfigurationDoneRequest: true })
        this.send({ type: 'event', event: 'initialized' })
        return

      case 'attach':
      case 'launch':
        if (this.options.deferAttachResponse) this.deferredAttach = message.seq
        else this.respond(message, {})
        return

      case 'setBreakpoints': {
        this.setBreakpointCalls += 1
        const args = (message.arguments ?? {}) as { source?: { path?: string }; breakpoints?: RecordedBreakpoint[] }
        const path = args.source?.path ?? ''
        const requested = args.breakpoints ?? []
        this.sources.set(path, requested)
        this.respond(message, {
          breakpoints: requested.map((b) => ({
            verified: this.options.verify !== false,
            line: this.options.slideTo ?? b.line,
            ...(this.options.verifyMessage ? { message: this.options.verifyMessage } : {}),
          })),
        })
        return
      }

      case 'configurationDone':
        this.respond(message, {})
        if (this.deferredAttach !== null) {
          this.send({ type: 'response', request_seq: this.deferredAttach, success: true, command: 'attach', body: {} })
          this.deferredAttach = null
        }
        return

      case 'disconnect':
        this.respond(message, {})
        this.send({ type: 'event', event: 'terminated' })
        return

      default:
        this.respond(message, {}, false, `unsupported request "${command}"`)
    }
  }

  private respond(request: DapMessage, body: unknown, success = true, message?: string): void {
    this.send({
      type: 'response',
      request_seq: request.seq,
      success,
      command: String(request.command),
      body,
      ...(message ? { message } : {}),
    })
  }

  private send(message: Record<string, unknown>): void {
    if (this.clientStream.destroyed) return
    this.clientStream.push(encodeMessage({ seq: this.seq++, ...message }))
  }
}
