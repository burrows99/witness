import { describe, expect, it } from 'vitest'
import { renderSkill, SPEC_FRONTMATTER_FIELDS, type SkillFacts } from '../../src/skill.js'

/**
 * The generated skill is derived from the project, not written by hand: as the
 * project gains a plan, an adapter or a policy, re-running the generator makes
 * the skill say so. That only works if generation is **deterministic** — a
 * timestamp or a random id would make "is this skill stale?" unanswerable.
 *
 * Frontmatter stays inside the six fields of the Agent Skills spec. Claude
 * Code accepts more, but claude.ai and the API reject unknown keys outright,
 * and a project whose thesis is "works with any vendor's agent" cannot ship a
 * skill that only loads in one of them.
 */

const facts = (over: Partial<SkillFacts> = {}): SkillFacts => ({
  project: 'acme-checkout',
  plans: [
    { id: 'checkout', intent: 'checkout applies the tiered discount', include: ['src/pricing/**'], exclude: [], assertions: 2, fixture: 'process' },
    { id: 'signup', intent: 'a new account can be created', include: ['src/accounts/**'], exclude: ['**/*.stories.tsx'], assertions: 0, fixture: 'none' },
  ],
  adapters: [
    { language: 'py', name: 'debugpy', available: true, detail: 'debugpy 1.8.21' },
    { language: 'ts', name: 'js-debug', available: false, detail: 'js-debug is not vendored in this build', remedy: 'Point SWE_VERIFY_JS_DEBUG at a dapDebugServer.js.' },
  ],
  browser: true,
  scope: { include: ['**'], exclude: ['**/*.md'], languages: ['ts', 'py'] },
  policy: { defensive: 'warn', waiverCapPct: 10, bypassLabel: 'swe-verify:bypass', runMs: 600_000, probeLines: 500 },
  ...over,
})

const frontmatter = (markdown: string): Record<string, string> => {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown)
  if (!match) throw new Error('no frontmatter')
  const out: Record<string, string> = {}
  for (const line of match[1]!.split('\n')) {
    const key = /^([a-z-]+):/.exec(line)
    if (key) out[key[1]!] = line.slice(key[0].length).trim()
  }
  return out
}

describe('frontmatter — the Agent Skills spec, and nothing beyond it', () => {
  it('opens with YAML frontmatter', () => {
    expect(renderSkill(facts()).startsWith('---\n')).toBe(true)
  })

  it('uses only fields the spec defines, so it loads outside Claude Code too', () => {
    for (const key of Object.keys(frontmatter(renderSkill(facts())))) {
      expect(SPEC_FRONTMATTER_FIELDS, `"${key}" is not an Agent Skills field`).toContain(key)
    }
  })

  it('names the skill in lowercase, numbers and hyphens, within 64 characters', () => {
    const name = frontmatter(renderSkill(facts())).name!
    expect(name).toMatch(/^[a-z0-9-]{1,64}$/)
  })

  it('keeps a name legal even when the project name is not', () => {
    const name = frontmatter(renderSkill(facts({ project: 'Acme  Checkout!! (v2)' }))).name!
    expect(name).toMatch(/^[a-z0-9-]{1,64}$/)
  })

  it('truncates a very long project name rather than emitting an illegal one', () => {
    const name = frontmatter(renderSkill(facts({ project: 'x'.repeat(200) }))).name!
    expect(name.length).toBeLessThanOrEqual(64)
  })

  it('describes when to use the skill, within the description budget', () => {
    const description = frontmatter(renderSkill(facts())).description!
    expect(description.length).toBeGreaterThan(40)
    expect(description.length).toBeLessThanOrEqual(1024)
    expect(description).toMatch(/acme-checkout/)
  })

  it('quotes a description that would otherwise break the YAML', () => {
    const markdown = renderSkill(facts({ project: 'a: b "c" #d' }))
    expect(() => frontmatter(markdown)).not.toThrow()
    expect(markdown).toMatch(/^description: "/m)
  })

  it('carries a fingerprint of the facts it was generated from', () => {
    expect(renderSkill(facts())).toMatch(/swe-verify-fingerprint: sha256:[0-9a-f]{64}/)
  })
})

describe('generation is deterministic — otherwise "is it stale?" has no answer', () => {
  it('produces identical output for identical facts', () => {
    expect(renderSkill(facts())).toBe(renderSkill(facts()))
  })

  it('embeds no date, time or random identifier', () => {
    const markdown = renderSkill(facts())
    expect(markdown).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(markdown).not.toMatch(/generated at/i)
  })

  it('changes its fingerprint when the project changes', () => {
    const before = renderSkill(facts())
    const after = renderSkill(facts({ plans: [...facts().plans, { id: 'refunds', intent: 'a refund restores stock', include: ['src/refunds/**'], exclude: [], assertions: 1, fixture: 'none' }] }))
    expect(after).not.toBe(before)
    expect(fingerprintOf(after)).not.toBe(fingerprintOf(before))
  })

  it('does not change its fingerprint when the plans are merely reordered', () => {
    const forward = renderSkill(facts())
    const reversed = renderSkill(facts({ plans: [...facts().plans].reverse() }))
    expect(fingerprintOf(reversed)).toBe(fingerprintOf(forward))
  })
})

describe('the body says what an agent working here has to know', () => {
  it('leads with the one command', () => {
    expect(renderSkill(facts())).toMatch(/swe-verify verify --plan <plan-id> --json/)
  })

  it('routes a change to the plan whose scope covers it', () => {
    const markdown = renderSkill(facts())
    expect(markdown).toMatch(/`checkout`/)
    expect(markdown).toMatch(/src\/pricing\/\*\*/)
    expect(markdown).toMatch(/`signup`/)
    expect(markdown).toMatch(/src\/accounts\/\*\*/)
  })

  it('carries each plan\'s intent, which is what a reviewer reads', () => {
    expect(renderSkill(facts())).toMatch(/checkout applies the tiered discount/)
  })

  it('flags a plan that asserts nothing, rather than presenting it as ready', () => {
    const markdown = renderSkill(facts())
    expect(markdown).toMatch(/signup[\s\S]{0,400}no assertions/i)
  })

  it('tells the agent what to do when no plan covers the change', () => {
    expect(renderSkill(facts())).toMatch(/swe-verify plan --intent/)
  })

  it('says which languages this project can actually gate', () => {
    const markdown = renderSkill(facts())
    expect(markdown).toMatch(/py.*debugpy/)
    expect(markdown).toMatch(/ts.*not vendored|ts.*cannot/i)
  })

  it('carries the remedy for an unavailable adapter, not just the fact', () => {
    expect(renderSkill(facts())).toMatch(/SWE_VERIFY_JS_DEBUG/)
  })

  it('explains every exit code, since that is the agent\'s read path', () => {
    const markdown = renderSkill(facts())
    for (const code of ['0', '2', '3', '4', '5']) expect(markdown).toMatch(new RegExp(`\\b${code}\\b`))
    expect(markdown).toMatch(/harness failure/i)
  })

  it('lists the findings an agent will meet, with what to do about them', () => {
    const markdown = renderSkill(facts())
    for (const code of ['SV001', 'SV003', 'SV010', 'SV011', 'SV020']) expect(markdown).toContain(code)
  })

  it('distinguishes a finding that blocks from one that only warns', () => {
    const markdown = renderSkill(facts())
    // SV010 stops a merge; SV021 does not, and saying otherwise would teach an
    // agent to treat a warning as a wall.
    expect(markdown).toMatch(/\| `SV010` \| blocks \|/)
    expect(markdown).toMatch(/\| `SV021` \| warns \|/)
    expect(markdown).toMatch(/\| `SV014` \| policy \|/)
  })

  it('states the policies that decide a verdict here', () => {
    const markdown = renderSkill(facts())
    expect(markdown).toMatch(/defensive.*warn/i)
    expect(markdown).toMatch(/10%/)
  })

  it('tells the agent not to weaken the plan to turn the gate green', () => {
    expect(renderSkill(facts()).toLowerCase()).toMatch(/never (narrow|weaken|remove)/)
  })

  it('says the gate runs in CI regardless, so the skill is not the enforcement', () => {
    expect(renderSkill(facts())).toMatch(/CI/)
  })
})

describe('a project that has not adopted swe-verify yet', () => {
  const fresh = () => facts({ plans: [], adapters: [], browser: false })

  it('still generates, and says the project has no plans', () => {
    const markdown = renderSkill(fresh())
    expect(markdown).toMatch(/no plans/i)
    expect(markdown).toMatch(/swe-verify plan --intent/)
  })

  it('does not claim a language is gateable when no adapter is present', () => {
    expect(renderSkill(fresh())).toMatch(/no debug adapter/i)
  })

  it('does not mention the browser driver when Playwright is absent', () => {
    expect(renderSkill(fresh())).not.toMatch(/driver: web|Playwright is installed/)
  })
})

function fingerprintOf(markdown: string): string {
  return /swe-verify-fingerprint: (sha256:[0-9a-f]{64})/.exec(markdown)?.[1] ?? ''
}
