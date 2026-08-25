import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { validateConfig, validatePlan, type GateResult } from '@witness/core'
import { adapterFor } from '@witness/probe-dap'

/**
 * L4 — witness gates its own change.
 *
 * "Rule 5 is the honest one. If witness cannot gate its own pull request,
 * there is no argument for asking anyone else to adopt it." (PRD §9.1)
 *
 * These tests run the built binary, in this repository, against this
 * repository's real diff. They are also where the project's own limits are
 * stated out loud: this build has no DAP adapter for TypeScript, so it gates
 * the parts of itself it can actually instrument, and says so rather than
 * pretending otherwise.
 */

const ROOT = join(import.meta.dirname, '..', '..')
const BIN = join(ROOT, 'packages', 'cli', 'dist', 'bin.js')

interface CliRun { code: number; stdout: string; stderr: string }

function swe(args: string[]): CliRun {
  try {
    const stdout = execFileSync('node', [BIN, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env } })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string }
    return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

const built = existsSync(BIN)
const suite = built ? describe : describe.skip

suite('the binary works, as a binary (NFR-6)', () => {
  it('runs from dist with no build step and no package install', () => {
    const result = swe(['--help'])
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/witness verify/)
  })

  it('emits JSON on stdout that parses, for every command an agent calls', () => {
    for (const args of [['doctor', '--json'], ['gate', '--json']]) {
      const result = swe(args)
      const payload = result.stdout.trim() || result.stderr.trim()
      expect(() => { JSON.parse(payload.split('\n').pop() ?? '') }, args.join(' ')).not.toThrow()
    }
  })
})

suite('this repository is configured for its own gate', () => {
  it('has a valid config', () => {
    const config = JSON.parse(readFileSync(join(ROOT, '.witness', 'config.json'), 'utf8'))
    expect(validateConfig(config).ok).toBe(true)
  })

  it('has at least one committed plan, and every plan is valid', () => {
    const dir = join(ROOT, '.witness', 'plans')
    const plans = readdirSync(dir).filter((f) => f.endsWith('.plan.json'))
    expect(plans.length).toBeGreaterThan(0)
    for (const file of plans) {
      const result = validatePlan(JSON.parse(readFileSync(join(dir, file), 'utf8')))
      expect(result.ok, `${file}: ${result.ok ? '' : result.findings.map((f) => f.message).join('; ')}`).toBe(true)
    }
  })

  it('gitignores run artefacts, which are per-run and large (D4)', () => {
    expect(readFileSync(join(ROOT, '.witness', '.gitignore'), 'utf8')).toMatch(/runs\//)
  })
})

suite('the gate runs against this repository right now', () => {
  it('produces a verdict with a documented exit code, on the real working tree', () => {
    const result = swe(['gate', '--json'])
    expect([0, 2, 5]).toContain(result.code)
    const gate = JSON.parse((result.stdout.trim() || result.stderr.trim()).split('\n').pop()!) as GateResult
    expect(['allow', 'block', 'bypass']).toContain(gate.verdict)
  })

  it('every finding it raises about us carries a remedy, same as for anyone else', () => {
    const result = swe(['gate', '--json'])
    const gate = JSON.parse((result.stdout.trim() || result.stderr.trim()).split('\n').pop()!) as GateResult
    for (const finding of gate.findings ?? []) expect(finding.remedy.length).toBeGreaterThan(10)
  })

  it('does not gate its own docs, config or plans — a gate that fires on a README typo gets disabled', () => {
    const result = swe(['gate', '--json'])
    const gate = JSON.parse((result.stdout.trim() || result.stderr.trim()).split('\n').pop()!) as GateResult
    for (const finding of gate.findings ?? []) {
      expect(finding.locus?.file ?? '').not.toMatch(/\.md$|\.witness\//)
    }
  })
})

suite('doctor is honest about what this build cannot do (NFR-12)', () => {
  it('reports adapter availability per declared language', () => {
    const report = JSON.parse(swe(['doctor', '--json']).stdout) as { checks: Array<{ name: string; detail: string; status: string; remedy?: string }> }
    const adapters = report.checks.filter((c) => c.name.startsWith('adapter:'))
    expect(adapters.map((a) => a.name).sort()).toEqual(['adapter:go', 'adapter:java', 'adapter:py', 'adapter:ts'])
  })

  it('says TypeScript is not instrumentable in this build, and what would fix it', () => {
    const report = JSON.parse(swe(['doctor', '--json']).stdout) as { checks: Array<{ name: string; status: string; detail: string; remedy?: string }> }
    const ts = report.checks.find((c) => c.name === 'adapter:ts')!
    if (adapterFor('ts').detect(ROOT, process.env).available) return
    expect(ts.status).toBe('warn')
    expect(ts.detail).toMatch(/js-debug/)
    expect(ts.remedy).toBeTruthy()
  })

  it('a missing adapter is a warning, not a failure — the gate still works without it', () => {
    const result = swe(['doctor', '--json'])
    expect(result.code).toBe(0)
  })
})
