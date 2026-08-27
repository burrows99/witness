import { describe, expect, it } from 'vitest'
import { parseArgs, UsageError } from '../../../src/cli/args.js'

describe('parseArgs', () => {
  it('reads the command and long flags', () => {
    const a = parseArgs(['gate', '--story', 'x.json', '--json'])
    expect(a.command).toBe('gate')
    expect(a.flag('story')).toBe('x.json')
    expect(a.bool('json')).toBe(true)
  })

  it('supports --flag=value', () => {
    expect(parseArgs(['gate', '--story=x.json']).flag('story')).toBe('x.json')
  })

  it('collects a repeatable flag', () => {
    expect(parseArgs(['plan', '--scope', 'a/**', '--scope', 'b/**']).list('scope')).toEqual(['a/**', 'b/**'])
  })

  it('treats a value starting with a dash as a value when quoted after =', () => {
    expect(parseArgs(['gate', '--bypass=-weird']).flag('bypass')).toBe('-weird')
  })

  it('rejects a flag that needs a value and has none', () => {
    expect(() => parseArgs(['gate', '--story']).flag('story', { required: true })).toThrow(UsageError)
  })

  it('rejects an unknown command with a usage error', () => {
    expect(() => parseArgs(['frobnicate'])).toThrow(UsageError)
  })

  it('treats no command as a usage error, not a crash', () => {
    expect(() => parseArgs([])).toThrow(UsageError)
  })

  it('accepts --help without a command', () => {
    expect(parseArgs(['--help']).command).toBe('help')
  })

  it('rejects an unknown flag rather than ignoring it', () => {
    const a = parseArgs(['gate', '--stroy', 'x.json'])
    expect(() => { a.assertKnown(['story', 'json']); }).toThrow(UsageError)
  })
})
