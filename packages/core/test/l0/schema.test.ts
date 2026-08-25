import { describe, expect, it } from 'vitest'
import { validateStory, validatePlan, validateConfig, resolveConfig } from '../../src/schema.js'
import { minimalStory, minimalPlan } from '../helpers/fixtures.js'

describe('validateStory — story@1', () => {
  it('accepts a minimal well-formed story', () => {
    const r = validateStory(minimalStory())
    expect(r.ok).toBe(true)
  })

  it('rejects a missing schema field with SV002', () => {
    const s = minimalStory() as unknown as Record<string, unknown>
    delete s.schema
    const r = validateStory(s)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.findings[0]!.code).toBe('SV002')
    expect(r.findings[0]!.remedy).toBeTruthy()
  })

  it('refuses an unknown major rather than best-effort parsing (NFR-9)', () => {
    const r = validateStory({ ...minimalStory(), schema: 'swe-verify/story@2' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.findings[0]!.code).toBe('SV002')
    expect(r.findings[0]!.message).toMatch(/major/i)
  })

  it('rejects a schema string for a different artefact', () => {
    const r = validateStory({ ...minimalStory(), schema: 'swe-verify/plan@1' })
    expect(r.ok).toBe(false)
  })

  it('ignores an unknown minor field, and warns once', () => {
    const s = { ...minimalStory(), somethingNewer: { added: 'in 1.4' } }
    const r = validateStory(s)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/somethingNewer/)
  })

  it('rejects a story whose events break the event union', () => {
    const s = minimalStory()
    s.events = [{ seq: 1, tier: 'server', trace_id: 't', wall: '2026-08-24T10:11:02.401Z', mono_ns: 1, type: 'logpoint' } as never]
    const r = validateStory(s)
    expect(r.ok).toBe(false)
  })

  it('rejects an unknown tier', () => {
    const s = minimalStory()
    s.events = [{ seq: 1, tier: 'quantum', trace_id: 't', wall: '2026-08-24T10:11:02.401Z', mono_ns: 1, type: 'step', driver: 'web', action: 'goto', args: {}, status: 'ok' } as never]
    expect(validateStory(s).ok).toBe(false)
  })

  it('validates before any field is read — a hostile story is data, never code', () => {
    const hostile = { schema: 'swe-verify/story@1', run_id: { toString: 'nope' } }
    expect(() => validateStory(hostile)).not.toThrow()
    expect(validateStory(hostile).ok).toBe(false)
  })
})

describe('validatePlan — plan@1', () => {
  it('accepts the worked-example plan', () => {
    expect(validatePlan(minimalPlan()).ok).toBe(true)
  })

  it('requires an intent and a scope', () => {
    const p = minimalPlan() as unknown as Record<string, unknown>
    delete p.scope
    expect(validatePlan(p).ok).toBe(false)
  })

  it('rejects a waiver with no expiry or no reason', () => {
    const p = minimalPlan()
    p.coverage = { policy: 'all-executable', waivers: [{ file: 'a.ts', lines: '1-2' }] as never }
    expect(validatePlan(p).ok).toBe(false)
  })

  it('rejects duplicate step seq values — seq is the join key', () => {
    const p = minimalPlan()
    p.steps = [
      { seq: 1, driver: 'api', action: 'get', args: { path: '/a' } },
      { seq: 1, driver: 'api', action: 'get', args: { path: '/b' } },
    ]
    const r = validatePlan(p)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.findings[0]!.message).toMatch(/seq/)
  })

  it('rejects an assertion referencing a step that does not exist', () => {
    const p = minimalPlan()
    p.assertions = [{ id: 'a1', kind: 'http-status', afterStep: 99, expect: { status: 200 } }]
    const r = validatePlan(p)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.findings[0]!.message).toMatch(/afterStep/)
  })
})

describe('resolveConfig — defaults are the free tier', () => {
  it('fills every default so an empty config is valid and offline', () => {
    const c = resolveConfig({ schema: 'swe-verify/config@1' })
    expect(c.vcs).toBe('auto')
    expect(c.runner).toBe('local')
    expect(c.artifactStore).toBe('fs')
    expect(c.telemetry).toBe('off')
    expect(c.coverage.defensive).toBe('warn')
    expect(c.coverage.waiverCapPct).toBe(10)
    expect(c.budgets.runMs).toBe(600_000)
    expect(c.redact.keys).toContain('password')
  })

  it('does not silently accept an unknown policy value', () => {
    expect(validateConfig({ schema: 'swe-verify/config@1', coverage: { policy: 'vibes' } }).ok).toBe(false)
  })

  it('keeps user values over defaults', () => {
    const c = resolveConfig({
      schema: 'swe-verify/config@1',
      coverage: { policy: 'all-executable', defensive: 'require', waiverCapPct: 0 },
    })
    expect(c.coverage.defensive).toBe('require')
    expect(c.coverage.waiverCapPct).toBe(0)
  })
})
