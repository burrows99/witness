import { describe, expect, it } from 'vitest'
import { buildLogMessage, parseLogOutput, LOGPOINT_MAGIC } from '../../src/logpoint.js'
import type { ProbeTarget } from '@swe-verify/core'

const target = (over: Partial<ProbeTarget> = {}): ProbeTarget => ({
  id: 'p001', file: 'src/a.ts', line: 41, language: 'ts', expressions: ['bonus', 'tier'], ...over,
})

describe('buildLogMessage', () => {
  it('interpolates each expression in DAP {expr} syntax', () => {
    const message = buildLogMessage(target())
    expect(message).toContain('{bonus}')
    expect(message).toContain('{tier}')
  })

  it('carries the probe id so an output line can be attributed', () => {
    expect(buildLogMessage(target({ id: 'p042' }))).toContain('p042')
  })

  it('starts with a magic marker, so app output is never mistaken for a probe', () => {
    expect(buildLogMessage(target()).startsWith(LOGPOINT_MAGIC)).toBe(true)
  })

  it('still fires with no expressions to capture — firing is the signal that matters', () => {
    const message = buildLogMessage(target({ expressions: [] }))
    expect(message.startsWith(LOGPOINT_MAGIC)).toBe(true)
    expect(message).not.toContain('{')
  })

  it('never emits a call expression, which could have side effects', () => {
    expect(buildLogMessage(target({ expressions: ['doTheThing()'] }))).not.toContain('doTheThing()')
  })
})

describe('parseLogOutput', () => {
  const fired = (over: Partial<ProbeTarget> = {}, values: string[] = ['0.1', '2']) => {
    let message = buildLogMessage(target(over))
    const expressions = (over.expressions ?? ['bonus', 'tier'])
    expressions.forEach((expr, i) => { message = message.replace(`{${expr}}`, values[i] ?? '') })
    return message
  }

  it('recognises a probe firing and reports which probe', () => {
    expect(parseLogOutput(fired())).toMatchObject({ probeId: 'p001' })
  })

  it('reads back the captured variables', () => {
    expect(parseLogOutput(fired())!.vars).toEqual({ bonus: 0.1, tier: 2 })
  })

  it('keeps a non-numeric value as a string', () => {
    expect(parseLogOutput(fired({}, ["'gold'", 'true']))!.vars).toEqual({ bonus: "'gold'", tier: true })
  })

  it('tolerates an adapter that could not evaluate an expression', () => {
    const out = parseLogOutput(fired({}, ['<error: name not defined>', '2']))
    expect(out!.vars.bonus).toBe('<error: name not defined>')
    expect(out!.probeId).toBe('p001')
  })

  it('returns null for ordinary application output', () => {
    expect(parseLogOutput('listening on port 3000')).toBeNull()
    expect(parseLogOutput('')).toBeNull()
  })

  it('finds a probe line embedded in a longer output chunk', () => {
    expect(parseLogOutput(`starting up\n${fired()}\n`)).toMatchObject({ probeId: 'p001' })
  })

  it('reports every probe line in a chunk that carries several', () => {
    const chunk = `${fired()}\n${fired({ id: 'p002' })}`
    expect(parseLogOutput(chunk, { all: true })).toHaveLength(2)
  })
})
