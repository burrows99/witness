import { describe, expect, it } from 'vitest'
import { FakeAdapter } from '../helpers/fake-adapter.js'
import { DapSession } from '../../src/session.js'
import type { ProbeTarget } from '@swe-verify/core'

/**
 * L1 — session behaviour against a protocol-conformant fake adapter. The real
 * adapters are exercised in adapter-contract.test.ts; this file pins the
 * behaviours real adapters make slow or impossible to provoke on demand.
 */

const target = (over: Partial<ProbeTarget> = {}): ProbeTarget => ({
  id: 'p001', file: 'src/a.ts', line: 41, language: 'ts', expressions: ['tier'], ...over,
})

async function session(adapter: FakeAdapter) {
  const s = DapSession.overStream(adapter.clientStream, { repoRoot: '/repo', timeoutMs: 2000 })
  await s.initialize()
  await s.attach({})
  return s
}

describe('handshake', () => {
  it('completes the initialize/attach/configurationDone sequence', async () => {
    const adapter = new FakeAdapter()
    const s = await session(adapter)
    await s.install([target()])
    await s.configurationDone()
    expect(adapter.commands).toEqual(['initialize', 'attach', 'setBreakpoints', 'configurationDone'])
    await s.uninstall()
  })

  it('does not deadlock when the adapter withholds the attach response until configurationDone', async () => {
    const adapter = new FakeAdapter({ deferAttachResponse: true })
    const s = await session(adapter)
    await s.install([target()])
    await expect(s.configurationDone()).resolves.toBeUndefined()
    await s.uninstall()
  })

  it('times out rather than hanging when the adapter never answers', async () => {
    const adapter = new FakeAdapter({ silent: true })
    const s = DapSession.overStream(adapter.clientStream, { repoRoot: '/repo', timeoutMs: 150 })
    await expect(s.initialize()).rejects.toThrow(/timed out/)
  })

  it('refuses a reverse request rather than leaving the adapter waiting', async () => {
    const adapter = new FakeAdapter()
    const s = await session(adapter)
    adapter.sendReverseRequest('runInTerminal')
    await new Promise((r) => setTimeout(r, 50))
    expect(adapter.reverseResponses).toHaveLength(1)
    expect(adapter.reverseResponses[0]!.success).toBe(false)
    await s.uninstall()
  })
})

describe('probe installation', () => {
  it('sets one logpoint per target and reports verification per probe', async () => {
    const adapter = new FakeAdapter()
    const s = await session(adapter)
    const installed = await s.install([target(), target({ id: 'p002', line: 42 })])
    expect(installed.map((p) => p.verified)).toEqual([true, true])
    expect(adapter.breakpointsFor('/repo/src/a.ts').map((b) => b.line)).toEqual([41, 42])
    await s.uninstall()
  })

  it('sends logpoints, never plain breakpoints — the process must not suspend', async () => {
    const adapter = new FakeAdapter()
    const s = await session(adapter)
    await s.install([target()])
    expect(adapter.breakpointsFor('/repo/src/a.ts')[0]!.logMessage).toBeTruthy()
    await s.uninstall()
  })

  it('reports an unverified probe rather than assuming it bound (R2)', async () => {
    const adapter = new FakeAdapter({ verify: false, verifyMessage: 'source file not found' })
    const s = await session(adapter)
    const installed = await s.install([target()])
    expect(installed[0]!.verified).toBe(false)
    expect(installed[0]!.message).toBe('source file not found')
    await s.uninstall()
  })

  it('records the bound line when the adapter slides the probe', async () => {
    const adapter = new FakeAdapter({ slideTo: 43 })
    const s = await session(adapter)
    const installed = await s.install([target()])
    expect(installed[0]!.adapterLine).toBe(43)
    await s.uninstall()
  })

  it('groups probes per file, because setBreakpoints replaces a file wholesale', async () => {
    const adapter = new FakeAdapter()
    const s = await session(adapter)
    await s.install([target(), target({ id: 'p002', line: 42 }), target({ id: 'p003', file: 'src/b.ts', line: 7 })])
    expect(adapter.setBreakpointCalls).toBe(2)
    expect(adapter.breakpointsFor('/repo/src/a.ts')).toHaveLength(2)
    await s.uninstall()
  })

  it('maps a repo path to the debuggee path before setting a probe (R2)', async () => {
    const adapter = new FakeAdapter()
    const s = DapSession.overStream(adapter.clientStream, {
      repoRoot: '/repo',
      pathMapping: { localRoot: '/repo', remoteRoot: '/app' },
      timeoutMs: 2000,
    })
    await s.initialize()
    await s.attach({})
    await s.install([target()])
    expect(adapter.breakpointsFor('/app/src/a.ts')).toHaveLength(1)
    await s.uninstall()
  })
})

describe('draining probe output', () => {
  it('turns a logpoint output event into a hit with its captured variables', async () => {
    const adapter = new FakeAdapter()
    const s = await session(adapter)
    await s.install([target()])
    adapter.fire('p001', { tier: '2' })
    await new Promise((r) => setTimeout(r, 20))
    const hits = s.drain()
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ probeId: 'p001', vars: { tier: 2 } })
    await s.uninstall()
  })

  it('counts repeated hits on the same probe', async () => {
    const adapter = new FakeAdapter()
    const s = await session(adapter)
    await s.install([target()])
    adapter.fire('p001', { tier: '1' })
    adapter.fire('p001', { tier: '2' })
    await new Promise((r) => setTimeout(r, 20))
    expect(s.hitsFor('p001')).toBe(2)
    await s.uninstall()
  })

  it('drains once — a second drain does not repeat the same events', async () => {
    const adapter = new FakeAdapter()
    const s = await session(adapter)
    await s.install([target()])
    adapter.fire('p001', { tier: '2' })
    await new Promise((r) => setTimeout(r, 20))
    expect(s.drain()).toHaveLength(1)
    expect(s.drain()).toHaveLength(0)
    await s.uninstall()
  })

  it('passes application output through untouched', async () => {
    const adapter = new FakeAdapter()
    const output: string[] = []
    const s = DapSession.overStream(adapter.clientStream, { repoRoot: '/repo', timeoutMs: 2000, onOutput: (t) => output.push(t) })
    await s.initialize()
    await s.attach({})
    adapter.output('listening on 3000\n')
    await new Promise((r) => setTimeout(r, 20))
    expect(output).toContain('listening on 3000\n')
    expect(s.drain()).toHaveLength(0)
    await s.uninstall()
  })

  it('counts an evaluation error as a hit, because the error proves the line ran', async () => {
    const adapter = new FakeAdapter()
    const s = await session(adapter)
    await s.install([target({ expressions: ['tier'] })])
    adapter.output("name 'tier' is not defined\n")
    await new Promise((r) => setTimeout(r, 20))
    expect(s.hitsFor('p001')).toBe(1)
    expect(s.drain()[0]!.vars.tier).toMatch(/not defined/)
    await s.uninstall()
  })

  it('does not guess when two probes requested the same unresolvable name', async () => {
    const adapter = new FakeAdapter()
    const s = await session(adapter)
    await s.install([target({ expressions: ['tier'] }), target({ id: 'p002', line: 42, expressions: ['tier'] })])
    adapter.output("name 'tier' is not defined\n")
    await new Promise((r) => setTimeout(r, 20))
    expect(s.hitsFor('p001')).toBe(0)
    expect(s.hitsFor('p002')).toBe(0)
    expect(s.diagnostics.some((d) => d.message.includes('tier'))).toBe(true)
    await s.uninstall()
  })
})

describe('teardown', () => {
  it('clears its logpoints and disconnects', async () => {
    const adapter = new FakeAdapter()
    const s = await session(adapter)
    await s.install([target()])
    await s.uninstall()
    expect(adapter.breakpointsFor('/repo/src/a.ts')).toHaveLength(0)
    expect(adapter.commands).toContain('disconnect')
  })

  it('tears down cleanly even when the adapter has already gone away', async () => {
    const adapter = new FakeAdapter()
    const s = await session(adapter)
    await s.install([target()])
    adapter.crash()
    await expect(s.uninstall()).resolves.toBeUndefined()
  })
})

describe('a launch that has to compile first', () => {
  /**
   * `dlv dap` builds the binary during `launch`, so on a real repository the
   * handshake can take minutes. A single fixed request timeout makes the tool
   * work on toy programs and time out on everything else — which is the least
   * useful place to draw the line.
   */
  it('waits longer for the launch handshake than for an ordinary request', async () => {
    const adapter = new FakeAdapter({ initializedDelayMs: 300 })
    const s = DapSession.overStream(adapter.clientStream, {
      repoRoot: '/repo',
      timeoutMs: 100,
      launchTimeoutMs: 3000,
    })
    await s.initialize()
    await expect(s.launch({})).resolves.toBeUndefined()
    await s.uninstall()
  })

  it('still gives up eventually, rather than hanging the run (NFR-11)', async () => {
    const adapter = new FakeAdapter({ initializedDelayMs: 5000 })
    const s = DapSession.overStream(adapter.clientStream, {
      repoRoot: '/repo',
      timeoutMs: 100,
      launchTimeoutMs: 200,
    })
    await s.initialize()
    await expect(s.launch({})).rejects.toThrow(/timed out/)
  })
})

describe('totalHits — the number that explains a slow run', () => {
  /**
   * A real run died on a ten-minute budget with a remedy suggesting the
   * budget was too small. What was actually happening: 97 probes on a
   * table-driven test with ~55 cases, so every instrumented line re-ran once
   * per case — thousands of DAP round-trips at roughly 60ms each.
   * `budgets.probeLines` caps how many lines are instrumented and says
   * nothing about how often they run, so the amplification was invisible and
   * the remedy pointed at the wrong lever.
   */
  it('is zero before anything fires', async () => {
    const adapter = new FakeAdapter()
    const s = await session(adapter)
    await s.install([target()])
    expect(s.totalHits()).toBe(0)
    await s.uninstall()
  })

  it('counts every firing, not every probe', async () => {
    const adapter = new FakeAdapter()
    const s = await session(adapter)
    await s.install([target({ id: 'p001' }), target({ id: 'p002', line: 42 })])
    adapter.fire('p001', {})
    adapter.fire('p001', {})
    adapter.fire('p002', {})
    await new Promise((r) => setTimeout(r, 20))
    expect(s.totalHits()).toBe(3)
    await s.uninstall()
  })
})
