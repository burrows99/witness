import { describe, expect, it } from 'vitest'
import { renderViewer } from '../../src/render.js'
import type { GateResult, Story } from '@swe-verify/core'

/**
 * The viewer exists because evidence nobody reads is theatre (TDD §7.9). It
 * has to be one self-contained file: a CI artifact is downloaded and opened
 * from a filesystem, with no server and often no network.
 *
 * It also renders a story, and a story is an artefact an untrusted pull
 * request can influence (TDD §10.1) — so every value in it is data, never
 * markup.
 */

const story = (over: Partial<Story> = {}): Story => ({
  schema: 'swe-verify/story@1',
  run_id: '01JB7QK3M9X2VYD8N4T6ZQWERT',
  plan_id: 'checkout',
  plan_sha256: `sha256:${'a'.repeat(64)}`,
  diff: { hash: `sha256:${'9'.repeat(64)}`, algo: 'normalised-v1', base_sha: 'b'.repeat(40), head_sha: 'e'.repeat(40), files: 1, changed_lines: 3 },
  vcs: { provider: 'local', actor: 'burrows99' },
  env: { cli: '0.1.0', os: 'linux/arm64', runner: 'local', domain: 'fullstack' },
  started_at: '2026-08-24T10:11:02.401Z',
  sealed_at: '2026-08-24T10:11:19.883Z',
  events: [
    { seq: 1, tier: 'browser', trace_id: 't1', step_seq: 1, wall: '2026-08-24T10:11:03.000Z', mono_ns: 1000, type: 'step', driver: 'web', action: 'click', args: { name: 'Place order' }, status: 'ok' },
    { seq: 2, tier: 'server', trace_id: 't1', step_seq: 1, wall: '2026-08-24T10:11:03.100Z', mono_ns: 1100, type: 'logpoint', probe_id: 'p001', file: 'src/pricing.py', line: 41, vars: { tier: 2, total: 42 }, hit: 1 },
    { seq: 3, tier: 'data', trace_id: 't1', step_seq: 1, wall: '2026-08-24T10:11:03.200Z', mono_ns: 1200, type: 'span', name: 'INSERT order', kind: 'client', attrs: { 'db.rows': 1 }, duration_ms: 12 },
    { seq: 4, tier: 'harness', trace_id: 't1', wall: '2026-08-24T10:11:04.000Z', mono_ns: 1300, type: 'assertion', assertion_id: 'a1', status: 'pass' },
  ],
  coverage: {
    policy: 'all-executable',
    lines: [
      { file: 'src/pricing.py', line: 40, class: 'executable', probe_id: 'p001', verified: true, hits: 3 },
      { file: 'src/pricing.py', line: 41, class: 'executable', probe_id: 'p002', verified: true, hits: 0 },
      { file: 'src/pricing.py', line: 55, class: 'unbound', probe_id: 'p003', verified: false, hits: 0 },
    ],
    summary: { executable: 3, fired: 1, unverified: 1, waived: 0, excluded: 4, defensive: 0 },
  },
  assertions: [{ id: 'a1', status: 'pass' }, { id: 'a2', status: 'fail', diff: 'total: expected 42.00, got 46.20' }],
  artifacts: [
    { kind: 'snapshot', path: 'artifacts/a11y/0001-after.yaml', sha256: `sha256:${'1'.repeat(64)}`, bytes: 812, readableBy: ['agent'], step_seq: 1 },
    { kind: 'screenshot', path: 'artifacts/frames/0001-after.png', sha256: `sha256:${'2'.repeat(64)}`, bytes: 41000, readableBy: ['human'], step_seq: 1 },
  ],
  diagnostics: [],
  ...over,
})

const gate = (over: Partial<GateResult> = {}): GateResult => ({
  verdict: 'block',
  findings: [
    { code: 'SV010', severity: 'error', message: 'changed line never executed: src/pricing.py:41', remedy: 'Add a step that reaches it, or waive it with a dated reason.', locus: { file: 'src/pricing.py', line: 41 } },
    { code: 'SV021', severity: 'warn', message: 'plan has no assertions', remedy: 'Add one.' },
  ],
  metrics: { executable: 3, fired: 1, unverified: 1, waived: 0, defensive: 0, assertionsPassed: 1, assertionsTotal: 2 },
  ...over,
})

describe('renderViewer — self-contained (NFR-4, FR-16)', () => {
  it('produces one HTML document with no external references', () => {
    const html = renderViewer({ story: story(), gate: gate() })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).not.toMatch(/src="https?:/)
    expect(html).not.toMatch(/href="https?:\/\/(?!swe-verify\.invalid)/)
    expect(html).not.toMatch(/<script[^>]+src=/)
    expect(html).not.toMatch(/@import/)
  })

  it('inlines its styles', () => {
    expect(renderViewer({ story: story(), gate: gate() })).toMatch(/<style>/)
  })

  it('works with no gate result, because a story is worth reading on its own', () => {
    expect(() => renderViewer({ story: story(), gate: null })).not.toThrow()
  })
})

describe('renderViewer — the verdict, in 30 seconds (US-4 AC3)', () => {
  it('leads with the verdict', () => {
    expect(renderViewer({ story: story(), gate: gate() })).toMatch(/BLOCK/)
    expect(renderViewer({ story: story(), gate: gate({ verdict: 'allow', findings: [] }) })).toMatch(/ALLOW/)
  })

  it('shows every finding with its remedy, not just its message', () => {
    const html = renderViewer({ story: story(), gate: gate() })
    expect(html).toMatch(/SV010/)
    expect(html).toMatch(/Add a step that reaches it/)
  })

  it('shows the coverage map, with the unexercised line marked', () => {
    const html = renderViewer({ story: story(), gate: gate() })
    expect(html).toMatch(/src\/pricing\.py/)
    expect(html).toMatch(/data-line="41"[^>]*data-state="unfired"/)
    expect(html).toMatch(/data-line="55"[^>]*data-state="unbound"/)
  })

  it('draws one swimlane per tier that has events', () => {
    const html = renderViewer({ story: story(), gate: gate() })
    for (const tier of ['browser', 'server', 'data', 'harness']) {
      expect(html).toMatch(new RegExp(`data-tier="${tier}"`))
    }
  })

  it('shows captured variable state inline', () => {
    expect(renderViewer({ story: story(), gate: gate() })).toMatch(/tier/)
    expect(renderViewer({ story: story(), gate: gate() })).toMatch(/42/)
  })

  it('links each artefact and says who can read it', () => {
    const html = renderViewer({ story: story(), gate: gate() })
    expect(html).toMatch(/href="artifacts\/a11y\/0001-after\.yaml"/)
    expect(html).toMatch(/agent/)
    expect(html).toMatch(/human/)
  })

  it('shows a failing assertion with its difference', () => {
    expect(renderViewer({ story: story(), gate: gate() })).toMatch(/expected 42\.00, got 46\.20/)
  })

  it('identifies the run and the change it verified', () => {
    const html = renderViewer({ story: story(), gate: gate() })
    expect(html).toMatch(/01JB7QK3M9X2VYD8N4T6ZQWERT/)
    expect(html).toMatch(/sha256:9999/)
  })
})

describe('renderViewer — a story is untrusted input (TDD §10.1)', () => {
  it('escapes markup in captured variable state', () => {
    const hostile = story()
    hostile.events = [{ seq: 1, tier: 'server', trace_id: 't', wall: 'w', mono_ns: 1, type: 'logpoint', probe_id: 'p', file: 'a.py', line: 1, vars: { evil: '<img src=x onerror=alert(1)>' }, hit: 1 }]
    const html = renderViewer({ story: hostile, gate: null })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })

  it('escapes markup in file paths and messages', () => {
    const hostile = story()
    hostile.coverage.lines = [{ file: '</td><script>alert(1)</script>', line: 1, class: 'executable', hits: 0 }]
    const html = renderViewer({ story: hostile, gate: null })
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('escapes markup in a finding remedy', () => {
    const html = renderViewer({ story: story(), gate: gate({ findings: [{ code: 'SV010', severity: 'error', message: 'x', remedy: '<script>alert(1)</script>' }] }) })
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('never emits a story field into a script context', () => {
    const html = renderViewer({ story: story(), gate: gate() })
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '')
    for (const script of scripts) expect(script).not.toContain('01JB7QK3M9X2VYD8N4T6ZQWERT')
  })
})
