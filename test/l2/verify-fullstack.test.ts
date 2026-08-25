import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { GateResult, Plan, Story } from '@swe-verify/core'
import { adapterFor } from '@swe-verify/probe-dap'
import { isPlaywrightAvailable } from '@swe-verify/driver-web'
import { TestRepo, cli } from '../helpers/repo.js'

/**
 * L2 — the M2 release criterion: a UI action links to the server frame it
 * caused, on one `trace_id`.
 *
 * This is the claim the whole product rests on. Three tiers — browser action,
 * server variable state, HTTP boundary — arrive in one artefact, correlated
 * at capture time rather than stitched together by timestamp afterwards.
 */

const PY_ENV = { SWE_VERIFY_PYTHON: join(process.cwd(), '.venv', 'bin', 'python') }
const available = adapterFor('py').detect(process.cwd(), process.env).available && isPlaywrightAvailable()

const APP = `import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

PAGE = """<!doctype html><html><body>
<main>
  <h1>Cart</h1>
  <p id="status">Ready</p>
  <button id="order">Place order</button>
</main>
<script>
document.getElementById('order').addEventListener('click', async () => {
  const res = await fetch('/orders', { method: 'POST' })
  const body = await res.json()
  document.getElementById('status').textContent = body.message
})
</script>
</body></html>"""

ITEMS = [{"sku": "a", "price": 10.0, "qty": 2}, {"sku": "b", "price": 5.0, "qty": 1}]


def cart_total(items):
    total = 0.0
    for item in items:
        total += item["price"] * item["qty"]
    return round(total, 2)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            return self.send_body(200, b'{"status":"ok"}', "application/json")
        return self.send_body(200, PAGE.encode(), "text/html")

    def do_POST(self):
        total = cart_total(ITEMS)
        payload = json.dumps({"message": "Order confirmed", "total": total}).encode()
        return self.send_body(201, payload, "application/json")

    def send_body(self, status, body, content_type):
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", int(os.environ.get("PORT", "8080"))), Handler).serve_forever()
`

/** The change under verification: a discount applied on the server. */
const CHANGED_APP = APP.replace(
  '        total += item["price"] * item["qty"]',
  '        line_total = item["price"] * item["qty"]\n        total += line_total',
)

function plan(): Plan {
  return {
    schema: 'swe-verify/plan@1',
    id: 'checkout',
    intent: 'placing an order shows a confirmation and totals the cart on the server',
    domain: 'fullstack',
    scope: { include: ['app/**'] },
    fixture: {
      kind: 'process',
      language: 'py',
      program: 'app/server.py',
      baseUrl: 'http://127.0.0.1:{port}',
      ready: [{ http: 'http://127.0.0.1:{port}/health', status: 200, timeoutMs: 30_000 }],
    },
    steps: [
      { seq: 1, driver: 'web', action: 'goto', args: { path: '/' } },
      { seq: 2, driver: 'web', action: 'click', args: { role: 'button', name: 'Place order' } },
      { seq: 3, driver: 'web', action: 'waitFor', args: { text: 'Order confirmed' } },
    ],
    assertions: [{ id: 'a1', kind: 'ui-text', afterStep: 3, expect: { visible: 'Order confirmed' } }],
  }
}

let repo: TestRepo
let base: string

beforeEach(() => {
  repo = new TestRepo()
  repo.write('app/server.py', APP)
  repo.write('.swe-verify/config.json', JSON.stringify({ schema: 'swe-verify/config@1', vcs: 'local' }))
  repo.writePlan(plan())
  base = repo.commit('base')
})
afterEach(() => repo.dispose())

const storyOf = (): Story => {
  const runs = join(repo.dir, '.swe-verify', 'runs')
  const id = readdirSync(runs).sort().at(-1)!
  return JSON.parse(readFileSync(join(runs, id, 'story.json'), 'utf8')) as Story
}

const suite = available ? describe : describe.skip

suite('verify — one story across browser, server and HTTP (M2)', () => {
  it('passes a change the browser flow actually exercised', async () => {
    repo.write('app/server.py', CHANGED_APP)
    const result = await cli(repo, ['verify', '--plan', 'checkout', '--base', base, '--json'], { env: PY_ENV })
    expect(result.json<GateResult>().findings.filter((f) => f.severity === 'error')).toEqual([])
    expect(result.code).toBe(0)
  })

  it('threads browser, server and boundary events onto one trace id (FR-13)', async () => {
    repo.write('app/server.py', CHANGED_APP)
    await cli(repo, ['verify', '--plan', 'checkout', '--base', base, '--json'], { env: PY_ENV })
    const story = storyOf()

    const tiers = new Set(story.events.map((e) => e.tier))
    expect(tiers.has('browser')).toBe(true)
    expect(tiers.has('server')).toBe(true)

    const traces = new Set(story.events.map((e) => e.trace_id))
    expect(traces.size).toBe(1)
  })

  it('links a UI action to the server frame it caused, by step', async () => {
    repo.write('app/server.py', CHANGED_APP)
    await cli(repo, ['verify', '--plan', 'checkout', '--base', base, '--json'], { env: PY_ENV })
    const story = storyOf()

    const click = story.events.find((e) => e.type === 'step' && e.action === 'click')!
    const serverFrames = story.events.filter((e) => e.type === 'logpoint' && e.step_seq === click.step_seq)
    expect(serverFrames.length).toBeGreaterThan(0)

    // The server frame carries the state at the changed line, and it sits
    // after the click that provoked it.
    expect(serverFrames[0]!.seq).toBeGreaterThan(click.seq)
    const vars = (serverFrames[0] as { vars: Record<string, unknown> }).vars
    expect(Object.keys(vars).length).toBeGreaterThan(0)
  })

  it('records a distinct span for each request the browser made', async () => {
    repo.write('app/server.py', CHANGED_APP)
    await cli(repo, ['verify', '--plan', 'checkout', '--base', base, '--json'], { env: PY_ENV })
    const spans = storyOf().events.filter((e) => e.type === 'span' && e.tier === 'browser')
    expect(spans.length).toBeGreaterThan(0)
    const ids = spans.map((s) => s.span_id).filter(Boolean)
    expect(new Set(ids).size).toBe(ids.length)
    expect(spans.some((s) => (s as { name: string }).name.includes('/orders'))).toBe(true)
  })

  it('leaves an agent-readable artefact for every browser step (FR-15)', async () => {
    repo.write('app/server.py', CHANGED_APP)
    await cli(repo, ['verify', '--plan', 'checkout', '--base', base, '--json'], { env: PY_ENV })
    const story = storyOf()
    for (const step of story.events.filter((e) => e.type === 'step' && e.driver === 'web')) {
      const forStep = story.artifacts.filter((a) => a.step_seq === step.step_seq)
      expect(forStep.some((a) => a.readableBy.includes('agent')), `step ${step.step_seq}`).toBe(true)
    }
  })

  it('blocks when the UI assertion fails, even though the code ran', async () => {
    repo.write('app/server.py', CHANGED_APP.replace('"message": "Order confirmed"', '"message": "Order pending"'))
    const result = await cli(repo, ['verify', '--plan', 'checkout', '--base', base, '--json'], { env: PY_ENV })
    expect(result.code).toBe(2)
    const finding = result.json<GateResult>().findings.find((f) => f.code === 'SV020')!
    expect(finding.message).toMatch(/Order confirmed/)
  })

  it('blocks a server change the browser flow never reaches', async () => {
    repo.write('app/server.py', APP.replace(
      'def cart_total(items):',
      'def apply_surcharge(total):\n    surcharge = total * 0.02\n    return round(total + surcharge, 2)\n\n\ndef cart_total(items):',
    ))
    const result = await cli(repo, ['verify', '--plan', 'checkout', '--base', base, '--json'], { env: PY_ENV })
    expect(result.code).toBe(2)
    expect(result.json<GateResult>().findings.map((f) => f.code)).toContain('SV010')
  })
})

suite('recording — evidence a reviewer can watch', () => {
  it('films the run and leaves an mp4 beside the story', async () => {
    repo.write('app/server.py', CHANGED_APP)
    const result = await cli(repo, ['run', '--plan', 'checkout', '--base', base, '--record', '--json'], { env: PY_ENV })
    expect(result.code).toBe(0)

    const recording = result.json<{ recording?: string }>().recording
    expect(recording, 'a filmed run must produce a recording').toBeTruthy()
    const file = join(repo.dir, recording!)
    expect(existsSync(file)).toBe(true)
    expect(statSync(file).size).toBeGreaterThan(10_000)
  })

  it('names the recording after the plan and the checkout it filmed', async () => {
    repo.write('app/server.py', CHANGED_APP)
    const result = await cli(repo, ['run', '--plan', 'checkout', '--base', base, '--record', '--json'], { env: PY_ENV })
    // The tree is dirty here (the change is uncommitted), and the name says so
    // — that recording cannot be reproduced from the commit alone.
    expect(result.json<{ recording: string }>().recording).toMatch(/checkout-.*-dirty\.mp4$/)
  })

  it('writes a title card saying which branch and commit it filmed', async () => {
    repo.write('app/server.py', CHANGED_APP)
    const result = await cli(repo, ['run', '--plan', 'checkout', '--base', base, '--record', '--json'], { env: PY_ENV })
    const card = join(repo.dir, result.json<{ recording: string }>().recording.replace(/\.mp4$/, '.slide.html'))
    const html = readFileSync(card, 'utf8')
    expect(html).toMatch(/placing an order/)
    expect(html).toMatch(/uncommitted/i)
  })

  it('produces a real H.264 mp4, not a renamed webm', async () => {
    repo.write('app/server.py', CHANGED_APP)
    const result = await cli(repo, ['run', '--plan', 'checkout', '--base', base, '--record', '--json'], { env: PY_ENV })
    const file = join(repo.dir, result.json<{ recording: string }>().recording)
    const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file], { encoding: 'utf8' })
    expect(probe.trim()).toBe('h264')
  })

  it('does not record when it was not asked to', async () => {
    repo.write('app/server.py', CHANGED_APP)
    const result = await cli(repo, ['run', '--plan', 'checkout', '--base', base, '--json'], { env: PY_ENV })
    expect(result.json<{ recording?: string }>().recording).toBeUndefined()
  })
})
