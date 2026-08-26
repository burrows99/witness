import type { StoryEvent } from './types.js'

/**
 * The ordering rule — TDD §7.1 / contracts §3.1.
 *
 * > Order is derived from (1) trace_id/parent_span_id causality, then
 * > (2) per-process monotonic time, then (3) harness-assigned seq as a
 * > tiebreak. Wall-clock timestamps are rendered but never sorted on. An
 * > event with no trace context attaches to the enclosing step.
 *
 * Containers skew clocks by more than a whole request, so sorting on `wall`
 * would produce a different story from the same file on every machine. This
 * is a topological sort over causality edges, with a deterministic tiebreak.
 *
 * `mono_ns` is only comparable inside one process; `tier` is the v1 stand-in
 * for process identity, so monotonic time orders events within a tier and
 * `seq` orders them across tiers.
 */
export function orderEvents(events: readonly StoryEvent[]): StoryEvent[] {
  const n = events.length
  if (n < 2) return [...events]

  // Rank each event among its own tier by monotonic time, so a single scalar
  // can express "monotonic within a tier, harness sequence across tiers".
  const monoRank = new Map<number, number>()
  const byTier = new Map<string, number[]>()
  events.forEach((e, i) => {
    const bucket = byTier.get(e.tier)
    if (bucket) bucket.push(i)
    else byTier.set(e.tier, [i])
  })
  for (const indices of byTier.values()) {
    indices
      .slice()
      .sort((a, b) => events[a]!.mono_ns - events[b]!.mono_ns || events[a]!.seq - events[b]!.seq)
      .forEach((idx, rank) => monoRank.set(idx, rank))
  }

  // Causality edges: parent span → child span, and enclosing step → the
  // events that belong to it.
  const bySpanId = new Map<string, number>()
  const stepIndex = new Map<number, number>()
  events.forEach((e, i) => {
    if (e.span_id && !bySpanId.has(e.span_id)) bySpanId.set(e.span_id, i)
    if (e.type === 'step' && e.step_seq !== undefined && !stepIndex.has(e.step_seq)) stepIndex.set(e.step_seq, i)
  })

  const successors: number[][] = Array.from({ length: n }, () => [])
  const indegree = new Array<number>(n).fill(0)
  const addEdge = (from: number, to: number) => {
    if (from === to) return
    successors[from]!.push(to)
    indegree[to] = indegree[to]! + 1
  }

  events.forEach((e, i) => {
    if (e.parent_span_id) {
      const parent = bySpanId.get(e.parent_span_id)
      if (parent !== undefined) addEdge(parent, i)
    }
    if (e.step_seq !== undefined && e.type !== 'step') {
      const step = stepIndex.get(e.step_seq)
      if (step !== undefined) addEdge(step, i)
    }
  })

  const better = (a: number, b: number) => {
    const ra = monoRank.get(a) ?? 0
    const rb = monoRank.get(b) ?? 0
    if (ra !== rb) return ra - rb
    if (events[a]!.seq !== events[b]!.seq) return events[a]!.seq - events[b]!.seq
    return a - b
  }

  const ready: number[] = []
  for (let i = 0; i < n; i += 1) if (indegree[i] === 0) ready.push(i)

  const out: StoryEvent[] = []
  const emitted = new Array<boolean>(n).fill(false)
  while (ready.length > 0) {
    ready.sort(better)
    const next = ready.shift()!
    emitted[next] = true
    out.push(events[next]!)
    for (const s of successors[next]!) {
      indegree[s] = indegree[s]! - 1
      if (indegree[s] === 0) ready.push(s)
    }
  }

  // A story is an artefact an untrusted PR can influence: cyclic parentage
  // must degrade to the sequence order, never hang the gate.
  if (out.length < n) {
    const leftovers = events
      .map((e, i) => ({ e, i }))
      .filter(({ i }) => !emitted[i])
      .sort((a, b) => a.e.seq - b.e.seq || a.i - b.i)
      .map(({ e }) => e)
    out.push(...leftovers)
  }
  return out
}
