import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { invoke } from '../../src/server.js'
import { argvFor } from '../../src/tools.js'

/**
 * L1 — the MCP adapter against the real CLI, in a real repository. What this
 * proves is the property the design depends on: the verdict an agent sees
 * through MCP is the verdict CI produces, because it is the same binary.
 */

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'swe-verify-mcp-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'test')
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1\n')
  mkdirSync(join(dir, '.swe-verify'), { recursive: true })
  writeFileSync(join(dir, '.swe-verify', 'config.json'), JSON.stringify({ schema: 'swe-verify/config@1', vcs: 'local' }))
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  return dir
}

describe('MCP tool calls run the CLI', () => {
  it('creates a plan an agent can then verify against', async () => {
    const dir = repo()
    try {
      const outcome = await invoke(argvFor('plan', { intent: 'pricing applies the discount', scope: ['src/**'] }), { cwd: dir, env: process.env })
      expect(outcome.exitCode).toBe(0)
      const payload = JSON.parse(outcome.stdout) as { command: string; plan: { scope: { include: string[] } } }
      expect(payload.command).toBe('plan')
      expect(payload.plan.scope.include).toEqual(['src/**'])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('returns the same GateResult the CLI returns — one gate, no drift', async () => {
    const dir = repo()
    try {
      writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1\nexport const b = 2\n')
      const viaMcp = await invoke(argvFor('gate', {}), { cwd: dir, env: process.env })
      const viaCli = await invoke(['gate', '--json'], { cwd: dir, env: process.env })
      expect(viaMcp.stdout).toBe(viaCli.stdout)
      expect(viaMcp.exitCode).toBe(viaCli.exitCode)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('reports a blocked gate as data, with an exit code, not as a crash', async () => {
    const dir = repo()
    try {
      writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1\nexport const b = 2\n')
      const outcome = await invoke(argvFor('gate', {}), { cwd: dir, env: process.env })
      expect(outcome.exitCode).toBe(2)
      const result = JSON.parse(outcome.stdout) as { verdict: string; findings: Array<{ remedy: string }> }
      expect(result.verdict).toBe('block')
      expect(result.findings[0]!.remedy).toBeTruthy()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('carries a bypass reason through to a recorded, amber verdict', async () => {
    const dir = repo()
    try {
      writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1\nexport const b = 2\n')
      const outcome = await invoke(argvFor('gate', { bypass: 'adapter is down today' }), { cwd: dir, env: process.env })
      expect(outcome.exitCode).toBe(5)
      expect(JSON.parse(outcome.stdout).verdict).toBe('bypass')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
