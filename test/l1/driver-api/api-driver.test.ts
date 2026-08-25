import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PlanStep, RunContext } from '../../../src/core/index.js'
import { compileRedactionPolicy, DEFAULT_CONFIG } from '../../../src/core/index.js'
import { ArtifactStore } from '../../../src/recorders/index.js'
import { ApiDriver } from '../../../src/driver-api/driver.js'
import { httpStatus, httpJson, assertionKinds } from '../../../src/driver-api/assertions.js'
import { parseTraceparent } from '../../../src/driver-api/trace.js'

/**
 * L1 — the `api` driver against a real HTTP server. The driver is the thing
 * that *acts*; what it records is what a story is made of.
 */

let server: Server
let baseUrl: string
let runDir: string
const received: Array<{ method: string; url: string; headers: Record<string, unknown>; body: string }> = []

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      received.push({ method: req.method!, url: req.url!, headers: req.headers, body })
      if (req.url?.startsWith('/orders/latest')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ status: 'confirmed', total: 42, items: [{ sku: 'a' }, { sku: 'b' }] }))
        return
      }
      if (req.url === '/slow') { setTimeout(() => { res.writeHead(200); res.end('late') }, 400); return }
      if (req.url === '/boom') { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('kaboom'); return }
      if (req.url === '/echo') { res.writeHead(201, { 'content-type': 'application/json' }); res.end(body || '{}'); return }
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  runDir = mkdtempSync(join(tmpdir(), 'witness-api-'))
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(runDir, { recursive: true, force: true })
})

const ctx = (): RunContext => ({
  runId: '01JB7QK3M9X2VYD8N4T6ZQWERT',
  repoRoot: process.cwd(),
  runDir,
  traceId: 'a'.repeat(32),
  baseUrl,
  env: {},
  log: () => {},
  monoNs: () => Number(process.hrtime.bigint()),
})

const store = () => new ArtifactStore({
  runDir,
  policy: compileRedactionPolicy(DEFAULT_CONFIG.redact),
  budgetBytes: 10_000_000,
})

const step = (over: Partial<PlanStep> = {}): PlanStep => ({ seq: 1, driver: 'api', action: 'get', args: { path: '/' }, ...over })

describe('ApiDriver', () => {
  it('declares the actions it supports', () => {
    expect(new ApiDriver().actions).toEqual(expect.arrayContaining(['get', 'post', 'put', 'patch', 'delete']))
  })

  it('performs a GET and records the transcript as an event', async () => {
    const result = await new ApiDriver({ store: store() }).execute(step({ args: { path: '/orders/latest' } }), ctx())
    expect(result.status).toBe('ok')
    const span = result.events.find((e) => e.type === 'span')!
    expect(span).toMatchObject({ tier: 'server', type: 'span' })
    expect((span as { attrs: Record<string, unknown> }).attrs['http.status_code']).toBe(200)
  })

  it('injects a traceparent so the server frame joins the same story (FR-13)', async () => {
    await new ApiDriver({ store: store() }).execute(step({ args: { path: '/' } }), ctx())
    const header = received.at(-1)!.headers.traceparent as string
    expect(parseTraceparent(header)?.traceId).toBe('a'.repeat(32))
  })

  it('sends a JSON body on POST and records the response', async () => {
    const result = await new ApiDriver({ store: store() }).execute(
      step({ action: 'post', args: { path: '/echo', body: { sku: 'a' } } }),
      ctx(),
    )
    expect(result.status).toBe('ok')
    expect(received.at(-1)!.body).toBe('{"sku":"a"}')
    expect((result.data!.response as { status: number }).status).toBe(201)
  })

  it('redacts a captured secret before the transcript reaches disk (NFR-5)', async () => {
    const result = await new ApiDriver({ store: store() }).execute(
      step({ seq: 5, action: 'post', args: { path: '/echo', body: { password: 'hunter2' }, headers: { authorization: 'Bearer abc123' } } }),
      ctx(),
    )
    const onDisk = readFileSync(join(runDir, result.artifacts[0]!.path), 'utf8')
    expect(onDisk).not.toContain('hunter2')
    expect(onDisk).not.toContain('abc123')
    expect(onDisk).toContain('[redacted]')
  })

  it('records no artefact when no store is configured, rather than writing unredacted bytes', async () => {
    const result = await new ApiDriver().execute(step({ args: { path: '/orders/latest' } }), ctx())
    expect(result.artifacts).toEqual([])
    expect(result.status).toBe('ok')
  })

  it('writes an agent-readable transcript artefact for the step (FR-15)', async () => {
    const result = await new ApiDriver({ store: store() }).execute(step({ seq: 3, args: { path: '/orders/latest' } }), ctx())
    const artifact = result.artifacts[0]!
    expect(artifact.readableBy).toContain('agent')
    expect(artifact.step_seq).toBe(3)
    const written = JSON.parse(readFileSync(join(runDir, artifact.path), 'utf8'))
    expect(written.response.body.status).toBe('confirmed')
  })

  it('treats a 5xx as a completed step, not a driver error — the assertion decides', async () => {
    const result = await new ApiDriver({ store: store() }).execute(step({ args: { path: '/boom' } }), ctx())
    expect(result.status).toBe('ok')
    expect((result.data!.response as { status: number }).status).toBe(500)
  })

  it('reports a connection failure as a step error with a usable message', async () => {
    const result = await new ApiDriver({ store: store() }).execute(step({ args: { path: '/' } }), { ...ctx(), baseUrl: 'http://127.0.0.1:1' })
    expect(result.status).toBe('error')
    expect(result.error).toMatch(/ECONNREFUSED|fetch failed/i)
  })

  it('times out rather than hanging the run (NFR-11)', async () => {
    const result = await new ApiDriver({ store: store() }).execute(step({ args: { path: '/slow', timeoutMs: 50 } }), ctx())
    expect(result.status).toBe('error')
    expect(result.error).toMatch(/timed out|abort/i)
  })

  it('rejects an unknown action instead of silently doing nothing', async () => {
    const result = await new ApiDriver({ store: store() }).execute(step({ action: 'teleport' }), ctx())
    expect(result.status).toBe('error')
    expect(result.error).toMatch(/teleport/)
  })

  it('accepts an absolute URL as well as a path', async () => {
    const result = await new ApiDriver({ store: store() }).execute(step({ args: { path: `${baseUrl}/orders/latest` } }), ctx())
    expect(result.status).toBe('ok')
  })

  it('sends query parameters and custom headers', async () => {
    await new ApiDriver({ store: store() }).execute(
      step({ args: { path: '/orders/latest', query: { page: 2 }, headers: { 'x-test': 'yes' } } }),
      ctx(),
    )
    expect(received.at(-1)!.url).toContain('page=2')
    expect(received.at(-1)!.headers['x-test']).toBe('yes')
  })
})

describe('assertion kinds', () => {
  const view = (response: unknown) => ({
    stepResult: () => ({ status: 'ok' as const, events: [], artifacts: [], data: { response } }),
    events: () => [],
    artifacts: () => [], readText: () => null,
  })

  it('registers every kind it implements', () => {
    expect(assertionKinds().map((k) => k.kind)).toEqual(expect.arrayContaining(['http-status', 'http-json']))
  })

  it('http-status passes on a match', async () => {
    expect((await httpStatus.evaluate({ status: 200 }, view({ status: 200 }), 1)).status).toBe('pass')
  })

  it('http-status fails with a readable difference', async () => {
    const result = await httpStatus.evaluate({ status: 200 }, view({ status: 500 }), 1)
    expect(result.status).toBe('fail')
    expect(result.diff).toMatch(/expected 200.*got 500/)
  })

  it('http-status skips, rather than passing, when the step produced nothing', async () => {
    const empty = { stepResult: () => undefined, events: () => [], artifacts: () => [], readText: () => null }
    expect((await httpStatus.evaluate({ status: 200 }, empty, 9)).status).toBe('skipped')
  })

  it('http-json compares a field by path', async () => {
    const response = { status: 200, body: { status: 'confirmed', total: 42 } }
    expect((await httpJson.evaluate({ path: 'body.total', equals: 42 }, view(response), 1)).status).toBe('pass')
    expect((await httpJson.evaluate({ path: 'body.status', equals: 'cancelled' }, view(response), 1)).status).toBe('fail')
  })

  it('http-json indexes into arrays', async () => {
    const response = { status: 200, body: { items: [{ sku: 'a' }, { sku: 'b' }] } }
    expect((await httpJson.evaluate({ path: 'body.items.1.sku', equals: 'b' }, view(response), 1)).status).toBe('pass')
  })

  it('http-json fails, rather than throwing, on a path that does not exist', async () => {
    const result = await httpJson.evaluate({ path: 'body.nope.deep', equals: 1 }, view({ status: 200, body: {} }), 1)
    expect(result.status).toBe('fail')
    expect(result.diff).toMatch(/body\.nope\.deep/)
  })

  it('http-json can assert containment instead of equality', async () => {
    const response = { status: 200, body: { message: 'Order confirmed for you' } }
    expect((await httpJson.evaluate({ path: 'body.message', contains: 'confirmed' }, view(response), 1)).status).toBe('pass')
  })
})
