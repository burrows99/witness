import { describe, expect, it } from 'vitest'
import { renderTape, tapeSlides, hasVhs } from '../../../src/recorders/terminal.js'

/**
 * A terminal recording, for work with no user interface.
 *
 * The alerting fix this was built for has no screen: what a reviewer needs to
 * see is a test failing, then the same test passing. The captions are the same
 * idea as the browser overlay — narration of what the frame shows — written as
 * comment lines the terminal actually renders, so nothing is claimed that the
 * frame does not display.
 */
describe('renderTape', () => {
  const tape = renderTape({
    output: '/runs/1/before.mp4',
    steps: [
      { caption: '① The test fails before the fix', command: 'go test ./pkg/x -run TestThing' },
      { caption: '② The context is already cancelled', command: 'echo done' },
    ],
  })

  it('writes an mp4, which is what a reviewer can actually play', () => {
    // Quoted, or VHS splits the path on `/` and rejects each segment.
    expect(tape).toMatch(/^Output "\/runs\/1\/before\.mp4"$/m)
  })

  it('never types narration into the shell — the terminal is for commands', () => {
    // A caption typed as a `# comment` pollutes the only frame that is meant
    // to be evidence: a viewer can no longer tell the tool's commentary from
    // the program's own output. Narration belongs on a spliced card.
    expect(tape).not.toMatch(/① The test fails before the fix/)
    expect(tape).not.toMatch(/#/)
  })

  it('reports the captions so the caller can render them as cards', () => {
    expect(tapeSlides({
      steps: [{ caption: 'first', command: 'a' }, { command: 'b' }, { caption: 'second', command: 'c' }],
    })).toEqual(['first', 'second'])
  })

  it('runs each command', () => {
    expect(tape).toMatch(/go test \.\/pkg\/x -run TestThing/)
  })

  it('runs the commands in order', () => {
    expect(tape.indexOf('go test')).toBeLessThan(tape.indexOf('echo done'))
  })

  it('holds at the end so the last output is readable', () => {
    expect(tape.trimEnd()).toMatch(/Sleep \d+m?s$/)
  })

  it('sets a size that keeps go test output on one line', () => {
    expect(tape).toMatch(/^Set Width \d+$/m)
    expect(tape).toMatch(/^Set FontSize \d+$/m)
  })

  it('escapes a command containing quotes rather than breaking the tape', () => {
    const escaped = renderTape({ output: 'o.mp4', steps: [{ caption: 'c', command: `echo "a\`b"` }] })
    expect(escaped).not.toMatch(/Type "echo "a/)
  })

  it('shows only the command for a step with no caption', () => {
    const bare = renderTape({ output: 'o.mp4', steps: [{ command: 'ls' }] })
    expect(bare).toMatch(/ls/)
    expect(bare.split('\n').filter((l) => l.includes('#'))).toHaveLength(0)
  })

  it('captures a transcript, which is what an agent can actually read', () => {
    const withTxt = renderTape({ output: 'o.mp4', transcript: '/runs/1/session.txt', steps: [{ command: 'ls' }] })
    expect(withTxt).toMatch(/script -q \/runs\/1\/session\.txt/)
  })

  it('keeps the transcript plumbing off camera', () => {
    const withTxt = renderTape({ output: 'o.mp4', transcript: '/runs/1/session.txt', cwd: '/repo', steps: [{ command: 'ls' }] })
    const hidden = withTxt.slice(withTxt.indexOf('Hide'), withTxt.indexOf('Show'))
    // The command under test is on camera; `cd` and `script` are not.
    expect(hidden).toMatch(/script -q/)
    expect(hidden).toMatch(/cd \/repo/)
    expect(withTxt.slice(withTxt.indexOf('Show'))).toMatch(/Type "ls"/)
    // `script` spawns a new shell, so the wipe must follow it.
    expect(hidden.indexOf('script -q')).toBeLessThan(hidden.indexOf('clear'))
  })

  it('can start in the directory the commands belong to', () => {
    expect(renderTape({ output: 'o.mp4', cwd: '/repo', steps: [{ command: 'ls' }] })).toMatch(/cd \/repo/)
  })

  it('shows the command itself, unaltered, on camera', () => {
    const tape = renderTape({ output: 'o.mp4', transcript: '/t.txt', steps: [{ command: 'go test ./pkg/x' }] })
    expect(tape).toMatch(/Type "go test \.\/pkg\/x"/)
    expect(tape).not.toMatch(/go test \.\/pkg\/x.*tee/)
  })

  it('allows a slow command to finish, rather than cutting at a fixed wait', () => {
    const slow = renderTape({ output: 'o.mp4', steps: [{ command: 'go build ./...', waitMs: 240_000 }] })
    expect(slow).toMatch(/240s|240000ms/)
  })
})

describe('the recorded shell cannot go interactive', () => {
  const tape = renderTape({ output: 'o.mp4', steps: [{ command: 'git log' }] })

  it('neutralises the pager, which otherwise swallows every later command', () => {
    expect(tape).toMatch(/Env PAGER "cat"/)
    expect(tape).toMatch(/Env GIT_PAGER "cat"/)
  })

  it('stops git prompting for credentials mid-recording', () => {
    expect(tape).toMatch(/Env GIT_TERMINAL_PROMPT "0"/)
  })

  it('sets the environment before the first command runs', () => {
    expect(tape.indexOf('Env PAGER')).toBeLessThan(tape.indexOf('git log'))
  })

  it('lets a caller add environment of its own', () => {
    expect(renderTape({ output: 'o.mp4', env: { CI: '1' }, steps: [{ command: 'ls' }] })).toMatch(/Env CI "1"/)
  })
})

describe('hasVhs', () => {
  it('answers without throwing, so a missing recorder degrades rather than crashing', () => {
    expect(typeof hasVhs()).toBe('boolean')
  })
})
