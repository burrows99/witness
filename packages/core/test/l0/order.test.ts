import { describe, expect, it } from 'vitest'
import { orderEvents } from '../../src/order.js'
import type { StoryEvent } from '../../src/types.js'

const span = (o: Partial<StoryEvent> & { seq: number }): StoryEvent =>
  ({
    tier: 'server',
    trace_id: 't1',
    wall: '2026-08-24T10:00:00.000Z',
    mono_ns: o.seq * 1000,
    type: 'span',
    name: `s${o.seq}`,
    kind: 'internal',
    attrs: {},
    duration_ms: 1,
    ...o,
  }) as StoryEvent

describe('orderEvents — the ordering rule (TDD §7.1)', () => {
  it('puts a child span after its parent even when seq says otherwise', () => {
    const parent = span({ seq: 9, span_id: 'p', mono_ns: 900 })
    const child = span({ seq: 2, span_id: 'c', parent_span_id: 'p', mono_ns: 100, tier: 'data' })
    expect(orderEvents([child, parent]).map((e) => e.seq)).toEqual([9, 2])
  })

  it('never sorts on wall clock — a skewed container cannot reorder a story', () => {
    const first = span({ seq: 1, mono_ns: 100, wall: '2026-08-24T10:00:05.000Z' })
    const second = span({ seq: 2, mono_ns: 200, wall: '2026-08-24T10:00:00.000Z' })
    expect(orderEvents([second, first]).map((e) => e.seq)).toEqual([1, 2])
  })

  it('orders by monotonic time within one tier', () => {
    const a = span({ seq: 5, mono_ns: 10 })
    const b = span({ seq: 4, mono_ns: 20 })
    expect(orderEvents([b, a]).map((e) => e.seq)).toEqual([5, 4])
  })

  it('falls back to harness sequence across tiers', () => {
    const browser = span({ seq: 1, tier: 'browser', mono_ns: 9_000_000 })
    const server = span({ seq: 2, tier: 'server', mono_ns: 5 })
    expect(orderEvents([server, browser]).map((e) => e.seq)).toEqual([1, 2])
  })

  it('attaches an event with no trace context to its enclosing step', () => {
    const step: StoryEvent = { seq: 1, tier: 'browser', trace_id: 't1', wall: 'w', mono_ns: 1, type: 'step', driver: 'web', action: 'click', args: {}, status: 'ok', step_seq: 2 }
    const orphan: StoryEvent = { seq: 7, tier: 'harness', trace_id: '', wall: 'w', mono_ns: 0, type: 'diagnostic', code: 'SV000', message: 'x', step_seq: 2 }
    expect(orderEvents([orphan, step]).map((e) => e.seq)).toEqual([1, 7])
  })

  it('is deterministic — the same input always yields the same order', () => {
    const events = [span({ seq: 3 }), span({ seq: 1 }), span({ seq: 2 })]
    expect(orderEvents(events).map((e) => e.seq)).toEqual(orderEvents([...events].reverse()).map((e) => e.seq))
  })

  it('does not hang on a story whose span parentage is cyclic', () => {
    const a = span({ seq: 1, span_id: 'a', parent_span_id: 'b' })
    const b = span({ seq: 2, span_id: 'b', parent_span_id: 'a' })
    const ordered = orderEvents([a, b])
    expect(ordered).toHaveLength(2)
    expect(ordered.map((e) => e.seq).sort()).toEqual([1, 2])
  })

  it('does not mutate the input array', () => {
    const events = [span({ seq: 2 }), span({ seq: 1 })]
    const before = events.map((e) => e.seq)
    orderEvents(events)
    expect(events.map((e) => e.seq)).toEqual(before)
  })
})
