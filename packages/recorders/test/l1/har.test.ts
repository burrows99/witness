import { describe, expect, it } from 'vitest'
import { failedEntries, harSummary, trimHar, type Har } from '../../src/har.js'

/**
 * The HAR is Playwright's, not ours — `recordHar` on the browser context
 * writes a real one, with real timings, headers and bodies, flushed when the
 * context closes. That is the same lifecycle as `recordVideo`, which is why
 * both belong to the recorder rather than the driver.
 *
 * What is left for us is the part Playwright cannot decide: a HAR carries
 * Authorization headers and session cookies — Playwright's own docs warn
 * against committing one — so it goes through the redacting ArtifactStore,
 * and it has to stay small enough to be worth keeping.
 */

const har = (over: Partial<Har['log']> = {}): Har => ({
  log: {
    version: '1.2',
    creator: { name: 'Playwright', version: '1.56.0' },
    entries: [
      {
        startedDateTime: '2026-08-25T10:00:00.000Z', time: 12,
        request: { method: 'GET', url: 'https://app.test/api/orders' },
        response: { status: 200, content: { size: 11, mimeType: 'application/json', text: '{"ok":true}' } },
      },
      {
        startedDateTime: '2026-08-25T10:00:01.000Z', time: 240,
        request: { method: 'POST', url: 'https://app.test/api/checkout' },
        response: { status: 500, content: { size: 24, mimeType: 'application/json', text: '{"error":"no such tier"}' } },
      },
    ],
    ...over,
  },
})

describe('failedEntries — what a reader should look at first', () => {
  it('picks out 4xx and 5xx', () => {
    expect(failedEntries(har()).map((e) => e.response.status)).toEqual([500])
  })

  it('counts a request that never got a response, which Playwright records as 0', () => {
    // A refused connection or a DNS failure is the most important entry in
    // the file, and it is the one with no status at all.
    const withTransportFailure = har({
      entries: [{
        startedDateTime: '2026-08-25T10:00:00.000Z', time: 0,
        request: { method: 'GET', url: 'https://app.test/api/x' },
        response: { status: 0, content: { size: 0, mimeType: '' } },
      }],
    })
    expect(failedEntries(withTransportFailure)).toHaveLength(1)
  })

  it('is empty when every request succeeded', () => {
    expect(failedEntries(har({ entries: [har().log.entries[0]!] }))).toEqual([])
  })
})

describe('harSummary — what goes in the harness log', () => {
  it('says how many requests there were and how many failed', () => {
    expect(harSummary(har())).toMatch(/2 request/)
    expect(harSummary(har())).toMatch(/1 failed/)
  })

  it('names the failing requests, so the log alone is often enough', () => {
    expect(harSummary(har())).toMatch(/POST .*\/api\/checkout.*500/)
  })
})

describe('trimHar — staying small enough to keep', () => {
  it('leaves a small HAR exactly as Playwright wrote it', () => {
    const original = har()
    expect(trimHar(original, 1024 * 1024)).toEqual(original)
  })

  /** Just tight enough that exactly one body has to go. */
  const oneBodyOver = () => Buffer.byteLength(JSON.stringify(har())) - 5

  it('drops response bodies before dropping the file, and says it did', () => {
    // The headers, statuses and timings are what diagnose a network bug; a
    // 40MB bundle in `content.text` is not evidence. Losing the whole HAR to
    // keep one body would be the wrong trade.
    const trimmed = trimHar(har(), oneBodyOver())
    expect(trimmed.log.entries[0]!.response.content.text).toBeUndefined()
    expect(trimmed.log.entries[0]!.response.content._trimmed).toBe(true)
    expect(trimmed.log.entries[0]!.request.url).toBe('https://app.test/api/orders')
  })

  it('drops the body of a failed request last, since a 500 body is the answer', () => {
    const trimmed = trimHar(har(), oneBodyOver())
    const failed = trimmed.log.entries.find((e) => e.response.status === 500)!
    expect(failed.response.content.text).toBe('{"error":"no such tier"}')
  })

  it('gives up bodies entirely rather than exceeding an impossible budget', () => {
    // Every entry keeps its request line, status and timing; only the bodies
    // go. Dropping entries would make the file lie about what happened.
    const trimmed = trimHar(har(), 10)
    expect(trimmed.log.entries).toHaveLength(2)
    expect(trimmed.log.entries.every((e) => e.response.content.text === undefined)).toBe(true)
  })
})
