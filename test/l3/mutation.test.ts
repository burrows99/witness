import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GateResult, Plan } from '@witness/core'
import { adapterFor } from '@witness/probe-dap'
import { TestRepo, cli } from '../helpers/repo.js'

/**
 * L3 — the tier that matters (TDD §12.1).
 *
 * A green suite proves the harness *ran*. It does not prove the harness would
 * have *caught* anything. So a fixture here is not an app but a triple:
 * (app, mutation, expected verdict). Each mutation is a bug a real change
 * would introduce; each null mutation is a harmless change that must not be
 * blocked.
 *
 * M1 (catch rate) and M2 (false-block rate) fall directly out and are printed
 * at the end of the run, because they are only meaningful as a pair: catch
 * rate alone is maximised by blocking everything.
 */

const PY_ENV = { WITNESS_PYTHON: join(process.cwd(), '.venv', 'bin', 'python') }
const SERVICE = readFileSync(join(import.meta.dirname, 'fixtures', 'service.py'), 'utf8')
const available = adapterFor('py').detect(process.cwd(), process.env).available

interface Mutation {
  name: string
  /** Why a gate that misses this is not worth having. */
  why: string
  apply: (source: string) => string
  expect: 'block' | 'allow'
  /** The finding that should catch it, when we can be specific. */
  code?: string
}

/**
 * Real bugs, of the shape the PRD names: a broken cart total, an off-by-one
 * paginator, a swallowed exception, an unexercised new branch.
 */
const MUTATIONS: Mutation[] = [
  {
    name: 'cart total drops an item',
    why: 'the classic agent bug: a loop that looks right and silently under-counts',
    apply: (s) => s.replace('        total += item["price"] * item["qty"]', '        total += item["price"]'),
    expect: 'block',
    code: 'SV020',
  },
  {
    name: 'discount applied at the wrong rate',
    why: 'exercised code that produces the wrong number — coverage cannot catch this, an assertion must',
    apply: (s) => s.replace('        discount = total * 0.10', '        discount = total * 0.25'),
    expect: 'block',
    code: 'SV020',
  },
  {
    name: 'paginator off by one',
    why: 'named in the PRD as a canonical injected bug',
    apply: (s) => s.replace('    start = (page - 1) * size', '    start = page * size'),
    expect: 'block',
    code: 'SV020',
  },
  {
    name: 'discount threshold raised out of reach',
    why: 'an exercised line whose new value silently disables a feature: assertions, not coverage, catch this',
    apply: (s) => s.replace('    if tier >= 2:', '    if tier >= 99:'),
    expect: 'block',
    code: 'SV020',
  },
  {
    name: 'a new branch the plan never drives',
    why: 'new code no step exercises — the case the coverage gate exists for',
    apply: (s) => s.replace(
      '    if tier >= 2:',
      '    if tier >= 5:\n        loyalty = total * 0.20\n        return round(total - loyalty, 2)\n    if tier >= 2:',
    ),
    expect: 'block',
    code: 'SV010',
  },
  {
    name: 'a new unexercised helper',
    why: 'dead-on-arrival code added alongside a real change',
    apply: (s) => s.replace(
      'def paginate(items, page, size):',
      'def audit_total(items):\n    flagged = [i for i in items if i["qty"] > 3]\n    return len(flagged)\n\n\ndef paginate(items, page, size):',
    ),
    expect: 'block',
    code: 'SV010',
  },
  {
    name: 'swallowed exception on an unexercised path',
    why: 'an except branch nothing drives: the gate must not call it verified',
    apply: (s) => s.replace(
      '    except ValueError:\n        return {"mode": "default"}',
      '    except ValueError:\n        recovered = {"mode": "recovered"}\n        return recovered',
    ),
    expect: 'block',
    code: 'SV010',
  },
  {
    name: 'response shape changed',
    why: 'a field rename that compiles, runs, and breaks every consumer',
    apply: (s) => s.replace('{"total": apply_discount(total, tier), "subtotal": total}', '{"amount": apply_discount(total, tier), "subtotal": total}'),
    expect: 'block',
    code: 'SV020',
  },
  {
    name: 'rounding widened to whole units',
    why: 'money arithmetic that is nearly right — exercised, plausible, and wrong',
    apply: (s) => s.replace('        return round(total - discount, 2)', '        return round(total - discount)'),
    expect: 'block',
    code: 'SV020',
  },
]

/**
 * Null mutations — harmless changes. M2 is not optional: a gate that cries
 * wolf is disabled within a week, which makes M1 irrelevant.
 */
const NULL_MUTATIONS: Mutation[] = [
  {
    name: 'a comment added',
    why: 'the most common harmless diff there is',
    apply: (s) => s.replace('def cart_total(items):', '# sums the cart, including quantities\ndef cart_total(items):'),
    expect: 'allow',
  },
  {
    name: 'a docstring added',
    why: 'documentation must never be gated',
    apply: (s) => s.replace('def apply_discount(total, tier):', 'def apply_discount(total, tier):\n    """Apply the tier discount."""'),
    expect: 'allow',
  },
  {
    name: 'whitespace reflowed',
    why: 'a formatter run must not stale a story',
    apply: (s) => s.replace('    total = 0.0', '    total  =  0.0'),
    expect: 'allow',
  },
  {
    name: 'an exercised line rewritten equivalently',
    why: 'a real code change that the plan does drive: the gate should pass it',
    apply: (s) => s.replace('        discount = total * 0.10', '        rate = 0.10\n        discount = total * rate'),
    expect: 'allow',
  },
  {
    name: 'an import reordered',
    why: 'import churn is not behaviour',
    apply: (s) => s.replace('import json\nimport os', 'import os\nimport json'),
    expect: 'allow',
  },
]

function planFor(): Plan {
  return {
    schema: 'witness/plan@1',
    id: 'pricing',
    intent: 'the cart totals and paginates correctly for a tier-2 customer',
    domain: 'fullstack',
    scope: { include: ['app/**'] },
    fixture: {
      kind: 'process',
      language: 'py',
      program: 'app/service.py',
      baseUrl: 'http://127.0.0.1:{port}',
      ready: [{ http: 'http://127.0.0.1:{port}/health', status: 200, timeoutMs: 30_000 }],
    },
    steps: [
      { seq: 1, driver: 'api', action: 'get', args: { path: '/cart/total', query: { tier: 2 } } },
      { seq: 2, driver: 'api', action: 'get', args: { path: '/items', query: { page: 2, size: 2 } } },
      { seq: 3, driver: 'api', action: 'get', args: { path: '/config', query: { raw: '{"mode":"live"}' } } },
    ],
    assertions: [
      { id: 'a1', kind: 'http-status', afterStep: 1, expect: { status: 200 } },
      { id: 'a2', kind: 'http-json', afterStep: 1, expect: { path: 'body.total', equals: 31.5 } },
      { id: 'a3', kind: 'http-json', afterStep: 1, expect: { path: 'body.subtotal', equals: 35 } },
      { id: 'a4', kind: 'http-json', afterStep: 2, expect: { path: 'body.items.0.sku', equals: 'c' } },
      { id: 'a5', kind: 'http-json', afterStep: 3, expect: { path: 'body.mode', equals: 'live' } },
    ],
  }
}

interface Outcome {
  name: string
  expected: 'block' | 'allow'
  verdict: string
  codes: string[]
}

const outcomes: Outcome[] = []

async function runMutation(mutation: Mutation): Promise<Outcome> {
  const repo = new TestRepo()
  try {
    repo.write('app/service.py', SERVICE)
    repo.write('.witness/config.json', JSON.stringify({ schema: 'witness/config@1', vcs: 'local' }))
    repo.writePlan(planFor())
    const base = repo.commit('base')

    // The mutation is applied exactly as a developer's change would be: to
    // the working tree, on top of a committed baseline.
    const mutated = mutation.apply(SERVICE)
    expect(mutated, `mutation "${mutation.name}" did not change the source`).not.toBe(SERVICE)
    writeFileSync(join(repo.dir, 'app', 'service.py'), mutated)

    const result = await cli(repo, ['verify', '--plan', 'pricing', '--base', base, '--json'], { env: PY_ENV })
    const gate = result.json<GateResult>()
    const outcome: Outcome = {
      name: mutation.name,
      expected: mutation.expect,
      verdict: gate.verdict ?? `error(${result.code})`,
      codes: (gate.findings ?? []).map((f) => f.code),
    }
    outcomes.push(outcome)
    return outcome
  } finally {
    repo.dispose()
  }
}

const suite = available ? describe : describe.skip

suite('L3 — injected bugs must be blocked (M1: catch rate)', () => {
  for (const mutation of MUTATIONS) {
    it(`blocks: ${mutation.name}`, async () => {
      const outcome = await runMutation(mutation)
      expect(outcome.verdict, `${mutation.name} — ${mutation.why}`).toBe('block')
      if (mutation.code) expect(outcome.codes).toContain(mutation.code)
    })
  }
})

suite('L3 — harmless changes must not be blocked (M2: false-block rate)', () => {
  for (const mutation of NULL_MUTATIONS) {
    it(`allows: ${mutation.name}`, async () => {
      const outcome = await runMutation(mutation)
      expect(outcome.verdict, `${mutation.name} — ${mutation.why}`).toBe('allow')
    })
  }
})

afterAll(() => {
  if (outcomes.length === 0) return
  const bad = outcomes.filter((o) => o.expected === 'block')
  const harmless = outcomes.filter((o) => o.expected === 'allow')
  const caught = bad.filter((o) => o.verdict === 'block').length
  const falseBlocks = harmless.filter((o) => o.verdict !== 'allow').length
  const m1 = bad.length ? (caught / bad.length) * 100 : 0
  const m2 = harmless.length ? (falseBlocks / harmless.length) * 100 : 0

  // Published every release, as a pair, per PRD §6.
  console.log([
    '',
    'witness L3 mutation results',
    `  M1 catch rate        ${m1.toFixed(1)}%  (${caught}/${bad.length} injected bugs blocked; target ≥ 95%)`,
    `  M2 false-block rate  ${m2.toFixed(1)}%  (${falseBlocks}/${harmless.length} harmless diffs blocked; target ≤ 2%)`,
    '',
  ].join('\n'))
})
