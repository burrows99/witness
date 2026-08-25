import { describe, expect, it, vi } from 'vitest'
import { encodeMessage, MessageDecoder } from '../../src/protocol.js'

describe('encodeMessage', () => {
  it('frames a message with a Content-Length header and a blank line', () => {
    const wire = encodeMessage({ seq: 1, type: 'request', command: 'initialize' })
    const [header, body] = wire.split('\r\n\r\n')
    expect(header).toBe(`Content-Length: ${Buffer.byteLength(body!, 'utf8')}`)
    expect(JSON.parse(body!)).toMatchObject({ command: 'initialize' })
  })

  it('counts bytes, not characters, for multi-byte payloads', () => {
    const wire = encodeMessage({ seq: 1, type: 'event', event: 'output', body: { output: 'héllo → ok' } })
    const [header, body] = wire.split('\r\n\r\n')
    expect(Number(header!.split(': ')[1])).toBe(Buffer.byteLength(body!, 'utf8'))
  })
})

describe('MessageDecoder', () => {
  const decode = (chunks: string[]) => {
    const seen: unknown[] = []
    const decoder = new MessageDecoder((m) => seen.push(m))
    for (const chunk of chunks) decoder.push(Buffer.from(chunk, 'utf8'))
    return seen
  }

  it('decodes a single complete message', () => {
    expect(decode([encodeMessage({ seq: 1, type: 'response', command: 'initialize' })])).toHaveLength(1)
  })

  it('decodes two messages arriving in one chunk', () => {
    const wire = encodeMessage({ seq: 1, type: 'event', event: 'initialized' }) + encodeMessage({ seq: 2, type: 'event', event: 'terminated' })
    expect(decode([wire])).toHaveLength(2)
  })

  it('reassembles a message split across chunk boundaries', () => {
    const wire = encodeMessage({ seq: 1, type: 'event', event: 'output', body: { output: 'x'.repeat(200) } })
    const chunks = [wire.slice(0, 12), wire.slice(12, 40), wire.slice(40)]
    expect(decode(chunks)).toHaveLength(1)
  })

  it('handles a header split mid-way through Content-Length', () => {
    const wire = encodeMessage({ seq: 1, type: 'event', event: 'initialized' })
    expect(decode([wire.slice(0, 5), wire.slice(5)])).toHaveLength(1)
  })

  it('preserves multi-byte characters split across a chunk boundary', () => {
    const wire = encodeMessage({ seq: 1, type: 'event', event: 'output', body: { output: '→→→' } })
    const buf = Buffer.from(wire, 'utf8')
    const split = buf.length - 4
    const seen: Array<{ body?: { output?: string } }> = []
    const decoder = new MessageDecoder((m) => seen.push(m as never))
    decoder.push(buf.subarray(0, split))
    decoder.push(buf.subarray(split))
    expect(seen[0]!.body!.output).toBe('→→→')
  })

  it('ignores malformed JSON rather than crashing the run', () => {
    const bad = `Content-Length: 5\r\n\r\n{oops`
    const onError = vi.fn()
    const decoder = new MessageDecoder(() => {}, onError)
    decoder.push(Buffer.from(bad, 'utf8'))
    expect(onError).toHaveBeenCalledOnce()
  })

  it('survives an adapter that emits an unexpected header', () => {
    const wire = `Content-Type: application/vscode-jsonrpc\r\nContent-Length: 32\r\n\r\n{"seq":1,"type":"event","event":"x"}`
    const seen: unknown[] = []
    new MessageDecoder((m) => seen.push(m)).push(Buffer.from(wire, 'utf8'))
    expect(seen.length).toBeLessThanOrEqual(1)
  })
})
