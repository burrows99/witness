import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileRedactionPolicy, DEFAULT_CONFIG, type RunContext } from '../../../src/core/index.js'
import { ArtifactStore } from '../../../src/recorders/store.js'
import { TerminalRecorder } from '../../../src/recorders/terminal-recorder.js'
import { renderTape, stripTerminalControl } from '../../../src/recorders/terminal.js'

/**
 * L1 — the terminal recorder, for work with no screen.
 *
 * The failure this guards against is specific and has already happened once:
 * a recording whose narration was typed into the shell as `# comment` lines.
 * A reader then cannot separate the tool's commentary from the program's own
 * output, and the frame that was supposed to be evidence is no longer
 * trustworthy. Narration belongs on a card.
 *
 * The second failure is quieter and also happened: captions passed in, no
 * cards rendered, narration silently dropped. A recording that loses its
 * narration without saying so is worse than one that never had any.
 */

function ctx(runDir: string): RunContext {
  return {
    runId: '01JB7QK3M9X2VYD8N4T6ZQWERT',
    repoRoot: process.cwd(),
    runDir,
    traceId: 'a'.repeat(32),
    env: {},
    log: () => {},
    monoNs: () => Number(process.hrtime.bigint()),
  }
}

const setup = () => {
  const runDir = mkdtempSync(join(tmpdir(), 'witness-term-'))
  return {
    runDir,
    store: new ArtifactStore({
      runDir,
      policy: compileRedactionPolicy(DEFAULT_CONFIG.redact),
      budgetBytes: 64 * 1024 * 1024,
    }),
  }
}

describe('narration never reaches the shell', () => {
  it('types the command and nothing else', () => {
    const tape = renderTape({
      output: '/tmp/out.mp4',
      steps: [{ caption: 'the test fails on a cancelled context', command: 'go test ./...' }],
    })
    const typed = tape.split('\n').filter((line) => line.startsWith('Type '))
    expect(typed.some((line) => line.includes('go test ./...'))).toBe(true)
    expect(tape).not.toContain('the test fails on a cancelled context')
    expect(typed.some((line) => line.includes('#'))).toBe(false)
  })
})

describe('TerminalRecorder', () => {
  it('declares the film and the transcript, because an agent cannot watch', () => {
    const { runDir, store } = setup()
    const recorder = new TerminalRecorder({
      source: { steps: [{ command: 'true' }] },
      store,
      workDir: join(runDir, 'raw-terminal'),
    })
    expect(recorder.produces).toContain('video')
    expect(recorder.produces).toContain('transcript')
  })

  it('plans one clip per beat, so a caption sits with the command it describes', () => {
    // All the cards at the front would be a preamble, not narration: a
    // reviewer scrubbing to a moment could not tell which beat they are in.
    const { runDir, store } = setup()
    const recorder = new TerminalRecorder({
      source: {
        steps: [
          { caption: 'BEFORE — the bug', command: 'git log --oneline -1' },
          { command: 'go build ./...' },
          { caption: 'the test fails', command: 'go test ./...' },
        ],
      },
      store,
      workDir: join(runDir, 'raw-terminal'),
    })
    const beats = recorder.beats()
    expect(beats).toHaveLength(3)
    expect(beats[0]!.caption).toBe('BEFORE — the bug')
    expect(beats[1]!.caption).toBeUndefined()
    expect(beats[2]!.caption).toBe('the test fails')
    // Each beat is its own tape, which is what puts its card beside it.
    expect(new Set(beats.map((b) => b.tapePath)).size).toBe(3)
  })

  it('never silently drops a caption it was given', () => {
    const { runDir, store } = setup()
    const recorder = new TerminalRecorder({
      source: { steps: [{ caption: 'a', command: 'true' }, { caption: 'b', command: 'true' }] },
      store,
      workDir: join(runDir, 'raw-terminal'),
    })
    expect(recorder.beats().filter((b) => b.caption).map((b) => b.caption)).toEqual(['a', 'b'])
  })

  it('reports why it recorded nothing rather than returning quietly', async () => {
    const lines: string[] = []
    const { runDir, store } = setup()
    const recorder = new TerminalRecorder({
      source: { steps: [{ command: 'true' }] },
      store,
      workDir: join(runDir, 'raw-terminal'),
      hasTool: () => false,
    })
    await recorder.start({ ...ctx(runDir), log: (line) => lines.push(line) })
    expect(await recorder.stop()).toEqual([])
    expect(lines.join(' ')).toMatch(/vhs/i)
  })

  it('records nothing, and says nothing, when the plan declared no beats', async () => {
    const { runDir, store } = setup()
    const recorder = new TerminalRecorder({ source: { steps: [] }, store, workDir: join(runDir, 'raw-terminal') })
    await recorder.start(ctx(runDir))
    expect(await recorder.stop()).toEqual([])
  })

  it('writes one tape per beat, quoting paths VHS would otherwise split', async () => {
    const { runDir, store } = setup()
    const workDir = join(runDir, 'raw-terminal')
    const recorder = new TerminalRecorder({
      source: { steps: [{ caption: 'one', command: 'true' }, { command: 'false' }] },
      store,
      workDir,
      // Stop before ffmpeg so the tapes can be inspected without the tools.
      hasTool: () => false,
    })
    await recorder.start(ctx(runDir))
    recorder.writeTapes()
    const tapes = readdirSync(workDir).filter((f) => f.endsWith('.tape')).sort()
    expect(tapes).toHaveLength(2)
    const first = readFileSync(join(workDir, tapes[0]!), 'utf8')
    expect(first).toMatch(/^Output "/m)
    expect(first).toContain('true')
    expect(first).not.toContain('one')
  })
})


describe('the transcript is the artefact an agent can actually read', () => {
  it('strips the colour, cursor and title sequences script captures verbatim', () => {
    const raw = '\u001b]2;go test\u0007\u001b[1m\u001b[32mPASS\u001b[0m\u001b[K\nok  pkg  0.5s\n'
    expect(stripTerminalControl(raw)).toBe('PASS\nok  pkg  0.5s')
  })

  it('keeps only the final state of a line the shell redrew', () => {
    // A prompt is repainted on every keystroke; the intermediate frames are
    // not information, and an agent reading them sees the same command several
    // times in several states of completion.
    expect(stripTerminalControl('g\rgo\rgo test\nok\n')).toBe('go test\nok')
  })

  it('leaves ordinary output untouched', () => {
    expect(stripTerminalControl('result 90\n')).toBe('result 90')
  })
})


describe('CRLF, which script writes on every line', () => {
  it('keeps the content of a CRLF-terminated line', () => {
    // Treating the CR of a CRLF as an overwrite marker takes the empty
    // segment after it and discards the whole line — which emptied a real
    // transcript completely while the video beside it looked fine.
    expect(stripTerminalControl('result 90\r\nok\r\n')).toBe('result 90\nok')
  })

  it('still treats a bare carriage return as an overwrite', () => {
    expect(stripTerminalControl('50%\r100%\r\n')).toBe('100%')
  })
})
