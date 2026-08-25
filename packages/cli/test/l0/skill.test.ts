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
  assertionKinds: ['terminal-match', 'http-status', 'http-json', 'ui-text'],
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

  it('warns that reverting the whole commit can film a healthy system', () => {
    // Found by a fresh agent following this file literally: the fix and its
    // strengthened test were one commit, so `git checkout <base>` reverted
    // the assertion too and the old weak test passed against the old buggy
    // code. The recording was green and proved nothing.
    expect(skill).toMatch(/HEAD~1 -- /)
    expect(skill.toLowerCase()).toMatch(/not the test|only the production line/)
    expect(skill.toLowerCase()).toMatch(/read the transcript|reproduces nothing|no reproduction/)
  })

  it('says to commit before filming, because the restore overwrites from HEAD', () => {
    // This destroyed a finished fix. `git checkout HEAD -- <file>` restores
    // the file as HEAD has it, so with the fix still uncommitted the
    // "put it back" step overwrote the work with the original — no stash, no
    // dangling blob, nothing to recover.
    expect(skill).toMatch(/git add -A && git commit/)
    expect(skill.toLowerCase()).toMatch(/before you film|first, always/)
    expect(skill.toLowerCase()).toMatch(/overwrites it with the original|the work is gone/)
  })

  it('warns that a reproduction must not end on the working state', () => {
    expect(skill.toLowerCase()).toMatch(/must not end on the working state/)
  })

  it('forks first, and targets the fork rather than the upstream project', () => {
    // Four agents each had to work this out. `--remote=false` is rejected
    // when a repo argument is given, and the fork's default branch is
    // `master` on older projects — targeting the upstream default silently
    // opens a pull request against someone else's repository.
    expect(skill).toMatch(/gh repo fork/)
    expect(skill).toMatch(/defaultBranchRef/)
    expect(skill.toLowerCase()).toMatch(/fork's own default branch/)
  })

  it('opens the PR with gh, and says the body carries placeholders', () => {
    expect(skill).toMatch(/gh pr create/)
    expect(skill).toMatch(/BEFORE_VIDEO|placeholder/)
  })

  it('is explicit that attaching video has no CLI path', () => {
    expect(skill).toMatch(/user-attachments/)
    expect(skill.toLowerCase()).toMatch(/cannot reach|no cli path/)
  })

  it('checks the attachment without a browser, which reports false failures', () => {
    // Two agents independently read `readyState: 0` on attachments that were
    // fine — under contention the video element's own fetch never fires — and
    // both nearly reported working evidence as broken.
    expect(skill).toMatch(/user-attachments\/assets/)
    expect(skill).toMatch(/content-type/i)
    expect(skill).not.toMatch(/readyState === 4/)
  })

  it('uses a ranged GET, since the presigned URL rejects a HEAD', () => {
    // The recipe as first written used `curl -I` and answered 403 on healthy
    // files: the redirect lands on a URL signed for GET alone.
    expect(skill).toMatch(/--range 0-1023/)
    expect(skill).not.toMatch(/curl -sI "\$loc"/)
  })

  it('says what a wrong content type means, rather than only what right looks like', () => {
    expect(skill).toMatch(/text\/html/)
    expect(skill.toLowerCase()).toMatch(/placeholder/)
  })

  it('documents the fixture kinds, which two agents had to reverse-engineer', () => {
    // Both worked them out by reading other repositories' committed plans,
    // and both then lost a run to `program` being resolved inside `file`'s
    // directory rather than from the repository root.
    expect(skill).toMatch(/"kind": "process"/)
    expect(skill).toMatch(/"kind": "compose"|`compose`/)
    expect(skill).toMatch(/resolved inside that directory/)
    expect(skill).toMatch(/awaitExit/)
    expect(skill).toMatch(/"ready"|`ready`/)
  })

  it('shows that http-json can read headers, not only the body', () => {
    expect(skill).toMatch(/headers\.content-type/)
  })

  it('names an assertion kind that fits a fixture with no HTTP and no page', () => {
    // An agent hit SV021 on a process fixture and had to read the tool's own
    // source to discover `terminal-match` existed. The skill named no
    // assertion kind at all, and the only example anywhere came from the
    // `plan` skeleton, which emits `http-status` — useless to a test binary.
    expect(skill).toMatch(/terminal-match/)
    expect(skill).toMatch(/"contains"/)
    expect(skill).toMatch(/afterStep": 0|afterStep: 0/)
  })

  it('only names assertion kinds this build actually ships', () => {
    const withoutBrowser = renderSkill(facts({ assertionKinds: ['terminal-match'] }))
    expect(withoutBrowser).toMatch(/terminal-match/)
    expect(withoutBrowser).not.toMatch(/`ui-text`/)
  })

  it('says how a plan declares what to film, or --record has nothing to record', () => {
    // The gap a fresh agent hit: it ran `verify --record`, got exit 0 and no
    // video, because no plan in the project declared anything filmable.
    expect(skill).toMatch(/"record"/)
    expect(skill).toMatch(/terminal/)
    expect(skill).toMatch(/caption/)
  })

  it('says a caption becomes a card rather than a line in the shell', () => {
    expect(skill.toLowerCase()).toMatch(/card spliced in front|never typed into the shell/)
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

  it('shows what a waiver looks like, not only that a cap exists', () => {
    // An agent hit three genuinely unreachable guards, reasoned correctly
    // that a waiver was the designed answer, and then had to guess the
    // schema: the skill named waivers three times — twice in the findings
    // table, once in the cap — and never showed one. It guessed a top-level
    // array with `line`; the real shape is `coverage.waivers` with `lines`.
    expect(skill).toMatch(/"coverage"[\s\S]{0,200}"waivers"/)
    expect(skill).toMatch(/"lines"/)
    expect(skill).toMatch(/"expires"/)
  })

  it('says what a waiver is for, so it is not read as an escape hatch', () => {
    expect(skill.toLowerCase()).toMatch(/cannot run|genuinely/)
    expect(skill.toLowerCase()).toMatch(/hard to test/)
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
