import { describe, expect, it } from 'vitest'
import { AGENTS_BEGIN, AGENTS_END, renderAgentsBlock, upsertAgentsBlock, renderPreCommitHook, VENDOR_HOOKS } from '../../src/agents.js'

/**
 * `AGENTS.md` and vendor hooks are *steering*, not enforcement (TDD §4). They
 * are generated from one source so that switching vendors changes a template,
 * not the gate — and so that what they say cannot drift from what the gate
 * actually does.
 */

describe('renderAgentsBlock', () => {
  it('tells the agent the one command it needs', () => {
    expect(renderAgentsBlock()).toMatch(/witness verify --plan/)
  })

  it('says what the gate blocks on, in the agent\'s terms', () => {
    const block = renderAgentsBlock()
    expect(block).toMatch(/never executed|exercised/i)
    expect(block).toMatch(/stale/i)
    expect(block).toMatch(/assertion/i)
  })

  it('is honest that CI enforces this whatever the agent does', () => {
    expect(renderAgentsBlock()).toMatch(/CI/)
  })

  it('is delimited, so it can be regenerated without clobbering the file', () => {
    const block = renderAgentsBlock()
    expect(block.startsWith(AGENTS_BEGIN)).toBe(true)
    expect(block.trimEnd().endsWith(AGENTS_END)).toBe(true)
  })
})

describe('upsertAgentsBlock', () => {
  it('appends to a file that has no managed block yet', () => {
    const result = upsertAgentsBlock('# My project\n\nSome house rules.\n')
    expect(result).toMatch(/# My project/)
    expect(result).toMatch(/Some house rules/)
    expect(result).toContain(AGENTS_BEGIN)
  })

  it('replaces an existing block rather than appending a second one', () => {
    const once = upsertAgentsBlock('# My project\n')
    const twice = upsertAgentsBlock(once)
    expect(twice.split(AGENTS_BEGIN)).toHaveLength(2)
    expect(twice.split(AGENTS_END)).toHaveLength(2)
  })

  it('preserves text written after the managed block', () => {
    const withTail = `${upsertAgentsBlock('# My project\n')}\n## House style\n\nUse tabs.\n`
    expect(upsertAgentsBlock(withTail)).toMatch(/Use tabs/)
  })

  it('creates the file content from nothing', () => {
    expect(upsertAgentsBlock('')).toContain(AGENTS_BEGIN)
  })
})

describe('vendor hooks — a latency optimisation, never the gate', () => {
  it('generates a shim for each supported vendor from one source', () => {
    expect(VENDOR_HOOKS.map((h) => h.vendor).sort()).toEqual(['claude-code', 'cursor', 'git'])
  })

  it('every hook invokes the same binary CI does', () => {
    for (const hook of VENDOR_HOOKS) expect(hook.render()).toMatch(/witness/)
  })

  it('the git hook fails the commit on a blocking verdict', () => {
    const script = renderPreCommitHook()
    expect(script.startsWith('#!/bin/sh')).toBe(true)
    expect(script).toMatch(/exit 2/)
  })

  it('the git hook lets a harness failure through rather than blocking a commit on our bug', () => {
    // Exit 4 is "we could not observe", which is not the developer's problem
    // to fix at commit time; CI is where the gate binds.
    expect(renderPreCommitHook()).toMatch(/\b4\b/)
  })

  it('every hook says it is advisory, so nobody mistakes it for the gate', () => {
    for (const hook of VENDOR_HOOKS) expect(hook.render().toLowerCase()).toMatch(/ci|advisory|fast feedback/)
  })
})
