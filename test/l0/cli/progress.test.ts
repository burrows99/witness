import { describe, expect, it } from 'vitest'
import {
  NO_PROGRESS,
  ProgressReporter,
  clearProgress,
  progressStyle,
  renderProgress,
  type ProgressEvent,
} from '../../../src/cli/progress.js'

/**
 * Progress has two consumers with opposite requirements: a terminal, which
 * wants one line redrawn, and MCP, which requires a monotonic number and
 * forbids a percentage. Both read the same events, so the events have to
 * satisfy the stricter of the two.
 */

function sink(): { events: ProgressEvent[]; report: ProgressReporter } {
  const events: ProgressEvent[] = []
  return { events, report: new ProgressReporter((e) => events.push(e)) }
}

/** A stderr that is not a terminal, which is what CI has. */
function pipe(): { written: string[]; stream: NodeJS.WritableStream } {
  const written: string[] = []
  return { written, stream: { write: (c: string) => { written.push(c); return true } } as unknown as NodeJS.WritableStream }
}

/** A stderr that is. */
function tty(): { written: string[]; stream: NodeJS.WritableStream } {
  const p = pipe()
  ;(p.stream as unknown as { isTTY: boolean }).isTTY = true
  return p
}

describe('ProgressReporter', () => {
  it('counts work done, so a caller does not thread a total through every layer', () => {
    const { events, report } = sink()
    report.expect(3)
    report.advance('instrument', 'a')
    report.advance('steps', 'b')
    expect(events.map((e) => [e.progress, e.total])).toEqual([[1, 3], [2, 3]])
  })

  it('never goes backwards, which MCP requires and a reader assumes', () => {
    const { events, report } = sink()
    report.expect(2)
    report.advance('a', 'one')
    report.note('a', 'still working')
    report.advance('a', 'two')
    const progress = events.map((e) => e.progress)
    expect(progress).toEqual([...progress].sort((x, y) => x - y))
  })

  it('reports a note without claiming a unit finished', () => {
    const { events, report } = sink()
    report.advance('fixture', 'up')
    report.note('fixture', 'waiting for ready')
    expect(events[1]!.progress).toBe(events[0]!.progress)
  })

  it('revises the total upward once the run knows its size, never downward', () => {
    const { events, report } = sink()
    report.expect(5)
    report.expect(9)
    report.expect(2)
    report.advance('steps', 'x')
    expect(events[0]!.total).toBe(9)
  })

  it('omits the total instead of guessing one', () => {
    const { events, report } = sink()
    report.advance('steps', 'x')
    expect(events[0]).not.toHaveProperty('total')
  })

  it('clamps at the total, so a busy run does not report 11/10', () => {
    const { events, report } = sink()
    report.expect(1)
    report.advance('a', 'one')
    report.advance('a', 'two')
    expect(events[1]!.progress).toBe(1)
  })

  it('defaults to discarding, so progress costs a caller who wants none nothing', () => {
    expect(() => { new ProgressReporter(NO_PROGRESS).advance('a', 'b'); }).not.toThrow()
  })
})

describe('rendering — stderr only, and never an animation into a log file', () => {
  it('prints whole lines when stderr is not a terminal', () => {
    // A carriage return in a CI log puts the whole run on one unreadable line,
    // which is what makes people turn progress off.
    const { written, stream } = pipe()
    renderProgress({ stderr: stream, tty: false, colour: false })({ phase: 'steps', progress: 2, total: 4, message: 'step 2/4' })
    expect(written[0]).toBe('steps 2/4 50%  step 2/4\n')
    expect(written[0]).not.toContain('\r')
  })

  it('redraws in place on a terminal', () => {
    const { written, stream } = tty()
    renderProgress({ stderr: stream, tty: true, colour: false })({ phase: 'steps', progress: 1, total: 2, message: 'go' })
    expect(written[0]).toMatch(/^\r/)
    expect(written[0]).not.toContain('\n')
  })

  it('pads over the previous line, so a shorter one leaves no tail behind', () => {
    const { written, stream } = tty()
    const render = renderProgress({ stderr: stream, tty: true, colour: false })
    render({ phase: 'instrument', progress: 1, total: 2, message: 'a very long message indeed' })
    render({ phase: 'steps', progress: 2, total: 2, message: 'x' })
    expect(written[1]!.length).toBeGreaterThanOrEqual(written[0]!.length)
  })

  it('shows a percentage only when a total is known', () => {
    const { written, stream } = pipe()
    const render = renderProgress({ stderr: stream, tty: false, colour: false })
    render({ phase: 'steps', progress: 3, message: 'no total' })
    expect(written[0]).not.toMatch(/%/)
  })

  it('emits no escape sequences when colour is off', () => {
    const { written, stream } = tty()
    renderProgress({ stderr: stream, tty: true, colour: false })({ phase: 'a', progress: 1, total: 1, message: 'b' })
    // eslint-disable-next-line no-control-regex
    expect(written[0]).not.toMatch(/\[/)
  })

  it('clears the line before the verdict prints, and only on a terminal', () => {
    const t = tty()
    clearProgress({ stderr: t.stream, tty: true })
    expect(t.written[0]).toContain('[K')

    const p = pipe()
    clearProgress({ stderr: p.stream, tty: false })
    expect(p.written).toEqual([])
  })
})

describe('style detection', () => {
  it('draws plainly when stderr is a pipe', () => {
    expect(progressStyle(pipe().stream, {})).toEqual({ tty: false, colour: false })
  })

  it('colours a terminal', () => {
    expect(progressStyle(tty().stream, {})).toEqual({ tty: true, colour: true })
  })

  it('honours NO_COLOR and TERM=dumb, but still reports that the run is alive', () => {
    for (const env of [{ NO_COLOR: '1' }, { TERM: 'dumb' }]) {
      const style = progressStyle(tty().stream, env)
      expect(style.colour).toBe(false)
      expect(style.tty).toBe(true)
    }
  })
})
