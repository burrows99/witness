import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PlanStep, RunContext } from '@macquery-labs/core'
import { compileRedactionPolicy, DEFAULT_CONFIG } from '@macquery-labs/core'
import { ArtifactStore } from '@macquery-labs/recorders'
import { parseTraceparent } from '@macquery-labs/driver-api'
import { WebDriver, isPlaywrightAvailable } from '../../src/index.js'
import { uiText } from '../../src/assertions.js'

/**
 * L1 — the `web` driver against a real browser and a real page.
 *
 * The load-bearing behaviour is not "it can click". It is that a UI action
 * links to the server frame it caused, on one trace id (M2), and that every
 * step leaves behind something the *agent* can read.
 */

const PAGE = `<!doctype html><html><body>
<main>
  <h1>Cart</h1>
  <p id="status">Ready</p>
  <label for="coupon">Coupon</label>
  <input id="coupon" name="coupon">
  <button id="order">Place order</button>
</main>
<script>
document.getElementById('order').addEventListener('click', async () => {
  const res = await fetch('/orders', { method: 'POST', body: JSON.stringify({ coupon: document.getElementById('coupon').value }) })
  const body = await res.json()
  document.getElementById('status').textContent = body.message
})
</script>
</body></html>`

let server: Server
let baseUrl: string
let runDir: string
const requests: Array<{ url: string; traceparent?: string }> = []

beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push({ url: req.url!, traceparent: req.headers.traceparent as string | undefined })
    if (req.url === '/orders') {
      res.writeHead(201, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ message: 'Order confirmed' }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(PAGE)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
})

afterAll(async () => { await new Promise<void>((r) => server.close(() => r())) })
afterEach(() => { if (runDir) rmSync(runDir, { recursive: true, force: true }) })

function ctx(): RunContext {
  runDir = mkdtempSync(join(tmpdir(), 'witness-web-'))
  return {
    runId: '01JB7QK3M9X2VYD8N4T6ZQWERT',
    repoRoot: process.cwd(),
    runDir,
    traceId: 'b'.repeat(32),
    baseUrl,
    env: {},
    log: () => {},
    monoNs: () => Number(process.hrtime.bigint()),
  }
}

const store = (c: RunContext) => new ArtifactStore({
  runDir: c.runDir,
  policy: compileRedactionPolicy(DEFAULT_CONFIG.redact),
  budgetBytes: 50_000_000,
})

const step = (over: Partial<PlanStep>): PlanStep => ({ seq: 1, driver: 'web', action: 'goto', args: {}, ...over })

const suite = isPlaywrightAvailable() ? describe : describe.skip

suite('WebDriver', () => {
  it('declares the actions it supports', () => {
    expect(new WebDriver().actions).toEqual(expect.arrayContaining(['goto', 'click', 'fill', 'press', 'waitFor', 'screenshot']))
  })

  it('navigates and records the step', async () => {
    const c = ctx()
    const driver = new WebDriver({ store: store(c) })
    try {
      const result = await driver.execute(step({ action: 'goto', args: { path: '/' } }), c)
      expect(result.status).toBe('ok')
      expect(result.events.some((e) => e.type === 'span')).toBe(true)
    } finally { await driver.close() }
  })

  it('clicks by accessible role and name, as a user would', async () => {
    const c = ctx()
    const driver = new WebDriver({ store: store(c) })
    try {
      await driver.execute(step({ action: 'goto', args: { path: '/' } }), c)
      const result = await driver.execute(step({ seq: 2, action: 'click', args: { role: 'button', name: 'Place order' } }), c)
      expect(result.status).toBe('ok')
    } finally { await driver.close() }
  })

  it('threads the run trace id onto every request the browser makes (M2)', async () => {
    const c = ctx()
    const driver = new WebDriver({ store: store(c) })
    try {
      requests.length = 0
      await driver.execute(step({ action: 'goto', args: { path: '/' } }), c)
      await driver.execute(step({ seq: 2, action: 'click', args: { role: 'button', name: 'Place order' } }), c)
      await driver.execute(step({ seq: 3, action: 'waitFor', args: { text: 'Order confirmed' } }), c)

      const order = requests.find((r) => r.url === '/orders')!
      expect(parseTraceparent(order.traceparent ?? '')?.traceId).toBe('b'.repeat(32))
    } finally { await driver.close() }
  })

  it('gives each request its own span, so a UI action links to the frame it caused', async () => {
    const c = ctx()
    const driver = new WebDriver({ store: store(c) })
    try {
      requests.length = 0
      await driver.execute(step({ action: 'goto', args: { path: '/' } }), c)
      const result = await driver.execute(step({ seq: 2, action: 'click', args: { role: 'button', name: 'Place order' } }), c)
      await driver.execute(step({ seq: 3, action: 'waitFor', args: { text: 'Order confirmed' } }), c)

      const spans = result.events.filter((e) => e.type === 'span')
      expect(spans.length).toBeGreaterThan(0)
      // Every span belongs to the step that provoked it.
      expect(spans.every((s) => s.step_seq === 2)).toBe(true)
      const ids = requests.map((r) => parseTraceparent(r.traceparent ?? '')?.spanId).filter(Boolean)
      expect(new Set(ids).size).toBe(ids.length)
    } finally { await driver.close() }
  })

  it('fills a field by its label', async () => {
    const c = ctx()
    const driver = new WebDriver({ store: store(c) })
    try {
      await driver.execute(step({ action: 'goto', args: { path: '/' } }), c)
      const result = await driver.execute(step({ seq: 2, action: 'fill', args: { label: 'Coupon', value: 'SAVE10' } }), c)
      expect(result.status).toBe('ok')
      expect((result.data!.value as string)).toBe('SAVE10')
    } finally { await driver.close() }
  })

  it('captures an agent-readable accessibility snapshot for every step (FR-15)', async () => {
    const c = ctx()
    const driver = new WebDriver({ store: store(c) })
    try {
      const result = await driver.execute(step({ action: 'goto', args: { path: '/' } }), c)
      const snapshot = result.artifacts.find((a) => a.kind === 'snapshot')!
      expect(snapshot.readableBy).toContain('agent')
      const text = readFileSync(join(c.runDir, snapshot.path), 'utf8')
      expect(text).toMatch(/button "Place order"/)
    } finally { await driver.close() }
  })

  it('captures a screenshot for the human reader', async () => {
    const c = ctx()
    const driver = new WebDriver({ store: store(c) })
    try {
      const result = await driver.execute(step({ action: 'goto', args: { path: '/' } }), c)
      const shot = result.artifacts.find((a) => a.kind === 'screenshot')!
      expect(shot.readableBy).toContain('human')
      expect(shot.bytes).toBeGreaterThan(0)
    } finally { await driver.close() }
  })

  it('records console output, which is where a broken page says so', async () => {
    const c = ctx()
    const driver = new WebDriver({ store: store(c) })
    try {
      await driver.execute(step({ action: 'goto', args: { path: '/' } }), c)
      const result = await driver.execute(step({ seq: 2, action: 'evaluate', args: { expression: "console.log('hello from the page')" } }), c)
      const console_ = result.artifacts.find((a) => a.kind === 'console')
      expect(console_ ? readFileSync(join(c.runDir, console_.path), 'utf8') : '').toMatch(/hello from the page/)
    } finally { await driver.close() }
  })

  it('fails the step, with a usable message, when a target is not there', async () => {
    const c = ctx()
    const driver = new WebDriver({ store: store(c) })
    try {
      await driver.execute(step({ action: 'goto', args: { path: '/' } }), c)
      const result = await driver.execute(step({ seq: 2, action: 'click', args: { role: 'button', name: 'Nonexistent', timeoutMs: 500 } }), c)
      expect(result.status).toBe('error')
      expect(result.error).toMatch(/Nonexistent/)
    } finally { await driver.close() }
  })

  it('still captures evidence when the step failed — a failed step is the interesting one', async () => {
    const c = ctx()
    const driver = new WebDriver({ store: store(c) })
    try {
      await driver.execute(step({ action: 'goto', args: { path: '/' } }), c)
      const result = await driver.execute(step({ seq: 2, action: 'click', args: { role: 'button', name: 'Nonexistent', timeoutMs: 500 } }), c)
      expect(result.artifacts.some((a) => a.readableBy.includes('agent'))).toBe(true)
    } finally { await driver.close() }
  })

  it('rejects an unknown action rather than silently doing nothing', async () => {
    const c = ctx()
    const driver = new WebDriver({ store: store(c) })
    try {
      const result = await driver.execute(step({ action: 'teleport' }), c)
      expect(result.status).toBe('error')
      expect(result.error).toMatch(/teleport/)
    } finally { await driver.close() }
  })
})

suite('ui-text assertion', () => {
  it('passes when the text is visible on the page after the step', async () => {
    const c = ctx()
    const driver = new WebDriver({ store: store(c) })
    try {
      await driver.execute(step({ action: 'goto', args: { path: '/' } }), c)
      const result = await driver.execute(step({ seq: 2, action: 'click', args: { role: 'button', name: 'Place order' } }), c)
      await driver.execute(step({ seq: 3, action: 'waitFor', args: { text: 'Order confirmed' } }), c)
      const view = { stepResult: () => result, events: () => [], artifacts: () => [], readText: () => null }
      expect((await uiText(driver).evaluate({ visible: 'Order confirmed' }, view, 2)).status).toBe('pass')
    } finally { await driver.close() }
  })

  it('fails with the text it did find, not just "no"', async () => {
    const c = ctx()
    const driver = new WebDriver({ store: store(c) })
    try {
      const result = await driver.execute(step({ action: 'goto', args: { path: '/' } }), c)
      const view = { stepResult: () => result, events: () => [], artifacts: () => [], readText: () => null }
      const outcome = await uiText(driver).evaluate({ visible: 'Order confirmed' }, view, 1)
      expect(outcome.status).toBe('fail')
      expect(outcome.diff).toMatch(/Ready|Cart/)
    } finally { await driver.close() }
  })
})

describe('playwright availability', () => {
  it('reports whether a browser driver is installed, rather than assuming', () => {
    expect(typeof isPlaywrightAvailable()).toBe('boolean')
  })
})
