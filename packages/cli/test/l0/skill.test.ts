import { describe, expect, it } from 'vitest'
import { renderSkill, SPEC_FRONTMATTER_FIELDS, type SkillFacts } from '../../src/skill.js'

/**
 * The generated skill is a *playbook*: numbered steps an agent runs, each one
 * a command, ending in a pull request a reviewer can watch. Everything
 * project-specific — which plans exist, what can be instrumented here, which
 * policies decide a verdict — is derived, so the file describes the project
 * today rather than on the day someone wrote it.
 *
 * That only works if generation is deterministic: a timestamp would make "is
 * this skill stale?" unanswerable.
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
  it('uses only fields the spec defines, so it loads outside Claude Code too', () => {
    for (const key of Object.keys(frontmatter(renderSkill(facts())))) {
      expect(SPEC_FRONTMATTER_FIELDS, `"${key}" is not an Agent Skills field`).toContain(key)
    }
  })

  it('names the skill in lowercase, numbers and hyphens, within 64 characters', () => {
    expect(frontmatter(renderSkill(facts())).name!).toMatch(/^[a-z0-9-]{1,64}$/)
  })

  it('keeps a name legal even when the project name is not', () => {
    expect(frontmatter(renderSkill(facts({ project: 'Acme  Checkout!! (v2)' }))).name!).toMatch(/^[a-z0-9-]{1,64}$/)
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
    expect(renderSkill(facts())).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('changes when the project changes, and not when plans are merely reordered', () => {
    const base = renderSkill(facts())
    const reordered = renderSkill(facts({ plans: [...facts().plans].reverse() }))
    const added = renderSkill(facts({
      plans: [...facts().plans, { id: 'refunds', intent: 'a refund restores stock', include: ['src/refunds/**'], exclude: [], assertions: 1, fixture: 'none' }],
    }))
    expect(reordered).toBe(base)
    expect(added).not.toBe(base)
  })
})

describe('the playbook — numbered steps, each one a command', () => {
  const skill = renderSkill(facts())

  it('runs from picking a plan through to a rendered PR', () => {
    for (const heading of [
      /## 1\. /, /## 2\. /, /## 3\. /, /## 4\. /, /## 5\. /, /## 6\. /, /## 7\. /,
    ]) expect(skill).toMatch(heading)
  })

  it('gives the one command that proves and films in a single step', () => {
    expect(skill).toMatch(/swe-verify verify --plan <plan-id> --record --json/)
  })

  it('films the reproduction by changing what is checked out, not by a flag', () => {
    // A tool that reverts files mid-run can leave a working tree wrecked if
    // the run dies. Which recording you get is decided by the checkout.
    expect(skill).toMatch(/git stash/)
    expect(skill).toMatch(/swe-verify run --plan <plan-id> --record/)
  })

  it('warns that a reproduction must not end on the working state', () => {
    expect(skill.toLowerCase()).toMatch(/must not end on the working state/)
  })

  it('opens the PR with gh, and says the body carries placeholders', () => {
    expect(skill).toMatch(/gh pr create/)
    expect(skill).toMatch(/BEFORE_VIDEO|placeholder/)
  })

  it('is explicit that attaching video has no CLI path', () => {
    expect(skill).toMatch(/user-attachments/)
    expect(skill.toLowerCase()).toMatch(/cannot reach|no cli path/)
  })

  it('tells the agent to check the video actually rendered', () => {
    expect(skill).toMatch(/readyState/)
  })

  it('lists where a run leaves its artefacts', () => {
    expect(skill).toMatch(/story\.json/)
    expect(skill).toMatch(/artifacts\/video/)
    expect(skill).toMatch(/harness\.log/)
  })
})

describe('what is derived from this project', () => {
  const skill = renderSkill(facts())

  it('routes a change to the plan whose scope covers it', () => {
    expect(skill).toMatch(/`checkout`/)
    expect(skill).toMatch(/src\/pricing\/\*\*/)
    expect(skill).toMatch(/checkout applies the tiered discount/)
  })

  it('flags a plan that asserts nothing, rather than presenting it as ready', () => {
    expect(skill).toMatch(/signup[\s\S]{0,400}no assertions/i)
  })

  it('says which languages this project can actually gate, with the remedy', () => {
    expect(skill).toMatch(/py.*debugpy/)
    expect(skill).toMatch(/SWE_VERIFY_JS_DEBUG/)
  })

  it('explains every exit code, since that is the agent\'s read path', () => {
    for (const code of ['0', '2', '3', '4', '5']) expect(skill).toContain('`' + code + '`')
    expect(skill).toMatch(/harness failure/i)
  })

  it('distinguishes a finding that blocks from one that only warns', () => {
    expect(skill).toMatch(/\| `SV010` \| blocks \|/)
    expect(skill).toMatch(/\| `SV021` \| warns \|/)
    expect(skill).toMatch(/\| `SV014` \| policy \|/)
  })

  it('states the policies that decide a verdict here', () => {
    expect(skill).toMatch(/defensive.*warn/i)
    expect(skill).toMatch(/10%/)
    expect(skill).toMatch(/swe-verify:bypass/)
  })

  it('says what the tooling cannot do here, rather than implying it can', () => {
    expect(skill).toMatch(/compose/)
    expect(skill).toMatch(/js-debug|ts/)
  })
})

describe('the rules that make a recording evidence', () => {
  const skill = renderSkill(facts())

  it('requires a run that records nothing to fail', () => {
    expect(skill.toLowerCase()).toMatch(/records nothing/)
  })

  it('separates what the frame renders from what was measured', () => {
    expect(skill).toMatch(/MEASURED/)
  })

  it('forbids narration typed into the app or the shell', () => {
    expect(skill.toLowerCase()).toMatch(/never typed into|spliced/)
  })

  it('forbids weakening a plan to turn the gate green', () => {
    expect(skill.toLowerCase()).toMatch(/never (narrow|weaken|remove)/)
  })

  it('says the gate runs in CI regardless, so the skill is not the enforcement', () => {
    expect(skill).toMatch(/CI/)
  })
})

describe('a project that has not adopted swe-verify yet', () => {
  const fresh = () => facts({ plans: [], adapters: [], browser: false })

  it('still generates, and sends the agent to write the first plan', () => {
    const skill = renderSkill(fresh())
    expect(skill).toMatch(/no plans/i)
    expect(skill).toMatch(/swe-verify plan --intent/)
  })

  it('does not claim a language is gateable when no adapter is present', () => {
    expect(renderSkill(fresh())).toMatch(/no debug adapter/i)
  })

  it('says filming is unavailable when Playwright is absent', () => {
    expect(renderSkill(fresh())).toMatch(/Playwright is not installed/)
  })
})
