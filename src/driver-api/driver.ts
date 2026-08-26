import { readNumber, readString, type Driver, type PlanArgs, type PlanStep, type RunContext, type StepResult } from '../core/index.js'
import type { ArtifactStore } from '../recorders/index.js'
import { newSpanId, traceparent } from './trace.js'

/**
 * The `api` driver: HTTP, and the free default for a backend-only change.
 *
 * A non-2xx response is *not* a driver error. The driver's job is to act and
 * record; whether a 500 is wrong is an assertion's decision. Conflating them
 * would make it impossible to write a plan that proves an error path.
 */

interface ApiRequestRecord {
  method: string
  url: string
  headers: Record<string, string>
  body?: unknown
}

interface ApiResponseRecord {
  status: number
  headers: Record<string, string>
  body: unknown
  durationMs: number
}

const METHODS: Record<string, string> = {
  get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH', delete: 'DELETE', head: 'HEAD', options: 'OPTIONS',
}

const DEFAULT_TIMEOUT_MS = 30_000

export interface ApiDriverOptions {
  /**
   * Where transcripts are written. Artefacts go through the store because
   * that is where redaction happens, before the bytes reach disk (NFR-5) —
   * a driver that writes its own files writes secrets into CI artifacts.
   */
  store?: ArtifactStore
}

export class ApiDriver implements Driver {
  readonly name = 'api'
  readonly actions = Object.keys(METHODS)

  constructor(private readonly options: ApiDriverOptions = {}) {}

  async execute(step: PlanStep, ctx: RunContext): Promise<StepResult> {
    const method = METHODS[step.action.toLowerCase()]
    if (!method) {
      return {
        status: 'error',
        error: `the api driver has no action "${step.action}" (supported: ${this.actions.join(', ')})`,
        events: [],
        artifacts: [],
      }
    }

    const args: PlanArgs = step.args ?? {}
    const requestBody = args.body
    const url = resolveUrl(readString(args, 'path', '/'), readRecord(args, 'query'), ctx.baseUrl)
    const spanId = newSpanId()
    const headers: Record<string, string> = {
      // The correlation id goes on the wire, not into a log line to be
      // matched up later (FR-13).
      traceparent: traceparent(ctx.traceId, spanId),
      accept: 'application/json, text/plain, */*',
      ...readRecord(args, 'headers'),
    }
    const hasBody = requestBody !== undefined && method !== 'GET' && method !== 'HEAD'
    if (hasBody && !headers['content-type']) headers['content-type'] = 'application/json'

    const controller = new AbortController()
    const timeoutMs = readNumber(args, 'timeoutMs', DEFAULT_TIMEOUT_MS)
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const startedMono = ctx.monoNs()
    const wall = new Date().toISOString()

    try {
      const response = await fetch(url, {
        method,
        headers,
        ...(hasBody ? { body: typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody) } : {}),
        signal: controller.signal,
      })
      const durationMs = Math.max(0, (ctx.monoNs() - startedMono) / 1e6)
      const responseBody = await readBody(response)

      const request: ApiRequestRecord = { method, url, headers, ...(hasBody ? { body: requestBody } : {}) }
      const record: ApiResponseRecord = {
        status: response.status,
        // `forEach` is typed the same way by both the DOM and Node's fetch
        // declarations; iterating or spreading is not.
        headers: collectHeaders(response.headers),
        body: responseBody,
        durationMs,
      }

      const artifact = this.options.store?.writeJson(
        {
          kind: 'transcript',
          name: `api/${String(step.seq).padStart(4, '0')}.http.json`,
          readableBy: ['agent', 'human'],
          stepSeq: step.seq,
        },
        { request, response: record },
      ) ?? null

      return {
        status: 'ok',
        events: [
          {
            tier: 'server',
            trace_id: ctx.traceId,
            span_id: spanId,
            step_seq: step.seq,
            wall,
            mono_ns: startedMono,
            type: 'span',
            name: `${method} ${new URL(url).pathname}`,
            kind: 'client',
            attrs: {
              'http.request.method': method,
              'http.status_code': response.status,
              'url.full': url,
            },
            duration_ms: durationMs,
          },
        ],
        artifacts: artifact ? [artifact] : [],
        data: { request, response: record },
      }
    } catch (error) {
      const aborted = (error as Error).name === 'AbortError'
      return {
        status: 'error',
        error: aborted
          ? `request to ${url} timed out after ${timeoutMs}ms`
          : `request to ${url} failed: ${describe(error)}`,
        events: [
          {
            tier: 'server',
            trace_id: ctx.traceId,
            span_id: spanId,
            step_seq: step.seq,
            wall,
            mono_ns: startedMono,
            type: 'diagnostic',
            code: aborted ? 'SVH020' : 'SVH021',
            message: describe(error),
          },
        ],
        artifacts: [],
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

function collectHeaders(headers: Response['headers']): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => { out[key] = value })
  return out
}

function describe(error: unknown): string {
  const err = error as { message?: string; cause?: { code?: string; message?: string } }
  // fetch wraps the real reason in `cause`; without it every failure reads
  // "fetch failed", which tells a developer nothing.
  const cause = err.cause?.code ?? err.cause?.message
  return cause ? `${err.message} (${cause})` : String(err.message ?? error)
}

/** A plan may omit a map entirely; anything present must actually be one. */
function readRecord(args: PlanArgs, key: string): Record<string, string | number | boolean> {
  const value = args[key]
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`plan argument "${key}" must be an object of values`)
  }
  return value as Record<string, string | number | boolean>
}

function resolveUrl(path: string, query: Record<string, string | number | boolean> | undefined, baseUrl: string | undefined): string {
  const url = /^https?:\/\//.test(path)
    ? new URL(path)
    : new URL(path.startsWith('/') ? path : `/${path}`, baseUrl ?? 'http://127.0.0.1')
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value))
  return url.toString()
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('json')) return text
  try { return JSON.parse(text) } catch { return text }
}
