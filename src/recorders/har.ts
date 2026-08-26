/**
 * The HAR Playwright wrote, made fit to keep.
 *
 * `recordHar` on the browser context produces a real HAR 1.2 file — genuine
 * timings, request and response headers, bodies — flushed when the context
 * closes. That is the same lifecycle as `recordVideo`, which is why both are
 * the recorder's business rather than the driver's, and it is why nothing
 * here builds a HAR: Playwright's is better than one we could assemble from
 * route interception, which sees no timing phases and no failed transports.
 *
 * Two things are left for us. A HAR carries Authorization headers and session
 * cookies — Playwright's own documentation warns against committing one — so
 * it is written through the redacting ArtifactStore rather than copied. And
 * it has to stay small enough to be worth keeping.
 */

interface HarContent {
  size: number
  mimeType: string
  text?: string
  /** Set when the body was dropped to keep the file within budget. */
  _trimmed?: boolean
}

export interface HarEntry {
  startedDateTime: string
  time: number
  request: { method: string; url: string; [key: string]: unknown }
  response: { status: number; content: HarContent; [key: string]: unknown }
  [key: string]: unknown
}

export interface Har {
  log: {
    version: string
    creator: { name: string; version: string }
    entries: HarEntry[]
    [key: string]: unknown
  }
}

/** A request that failed outright, or answered 4xx/5xx. */
export function failedEntries(har: Har): HarEntry[] {
  // Status 0 is how Playwright records a transport failure — a refused
  // connection, a DNS error. It is the most important entry in the file and
  // the one with no status at all, so it has to be named explicitly.
  return har.log.entries.filter((e) => e.response.status === 0 || e.response.status >= 400)
}

export function harSummary(har: Har): string {
  const failed = failedEntries(har)
  const head = `${har.log.entries.length} request(s), ${failed.length} failed`
  if (failed.length === 0) return head
  const named = failed
    .slice(0, 5)
    .map((e) => `${e.request.method} ${e.request.url} → ${e.response.status === 0 ? 'no response' : e.response.status}`)
  return `${head}: ${named.join('; ')}${failed.length > 5 ? `; and ${failed.length - 5} more` : ''}`
}

/**
 * Bring a HAR under a byte budget by dropping response bodies, worst
 * candidates first — never by dropping entries. Headers, statuses and timings
 * are what diagnose a network bug; a 40MB bundle in `content.text` is not
 * evidence. Bodies of failed requests are kept longest, because a 500's body
 * is usually the answer.
 */
export function trimHar(har: Har, maxBytes: number): Har {
  if (Buffer.byteLength(JSON.stringify(har)) <= maxBytes) return har

  const clone = JSON.parse(JSON.stringify(har)) as Har
  const failed = new Set(failedEntries(clone))
  const order = [
    ...clone.log.entries.filter((e) => !failed.has(e)),
    ...clone.log.entries.filter((e) => failed.has(e)),
  ]

  for (const entry of order) {
    if (Buffer.byteLength(JSON.stringify(clone)) <= maxBytes) break
    if (entry.response.content.text === undefined) continue
    delete entry.response.content.text
    entry.response.content._trimmed = true
  }
  return clone
}
