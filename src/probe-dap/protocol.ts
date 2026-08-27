/**
 * DAP wire format: `Content-Length: <bytes>\r\n\r\n<json>`.
 *
 * Framing is byte-oriented, so the decoder works on Buffers throughout. A
 * character-oriented decoder corrupts multi-byte output the moment a chunk
 * boundary lands mid-codepoint — which happens constantly with real adapter
 * output, and produces a bug that looks like "the probe fired garbage".
 */

export interface DapMessage {
  seq: number
  type: 'request' | 'response' | 'event'
  [key: string]: unknown
}

export interface DapResponse extends DapMessage {
  type: 'response'
  request_seq: number
  success: boolean
  command: string
  message?: string
  body?: unknown
}

export interface DapEvent extends DapMessage {
  type: 'event'
  event: string
  body?: unknown
}

export function encodeMessage(message: Record<string, unknown>): string {
  const body = JSON.stringify(message)
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`
}

const HEADER_END = Buffer.from('\r\n\r\n', 'utf8')

export class MessageDecoder {
  private buffer: Buffer = Buffer.alloc(0)

  constructor(
    private readonly onMessage: (message: DapMessage) => void,
    private readonly onError: (error: Error, raw: string) => void = () => {},
  ) {}

  push(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    for (;;) {
      const headerEnd = this.buffer.indexOf(HEADER_END)
      if (headerEnd < 0) return

      const header = this.buffer.subarray(0, headerEnd).toString('utf8')
      const match = /content-length:\s*(\d+)/i.exec(header)
      if (!match) {
        // Unparseable header: drop it and resynchronise rather than stall.
        this.buffer = this.buffer.subarray(headerEnd + HEADER_END.length)
        continue
      }

      const length = Number(match[1])
      const start = headerEnd + HEADER_END.length
      if (this.buffer.length < start + length) return

      const raw = this.buffer.subarray(start, start + length).toString('utf8')
      this.buffer = this.buffer.subarray(start + length)
      try {
        this.onMessage(JSON.parse(raw) as DapMessage)
      } catch (error) {
        this.onError(error as Error, raw)
      }
    }
  }
}
