import { describe, expect, it } from 'vitest'
import { mkdtempSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileRedactionPolicy, DEFAULT_CONFIG, type RunContext } from '@swe-verify/core'
import { ArtifactStore } from '../../src/store.js'
import { BrowserRecorder } from '../../src/browser.js'
import { hasFfmpeg } from '../../src/video.js'

/**
 * L1 — the browser recorder as a session, producing a real artefact.
 *
 * The point of the seam: the recording ends up in the story's artefact list
 * with a declared reader, so the gate, the viewer and the agent can all find
 * it. A video the driver keeps to itself is invisible to every one of them.
 */

const suite = hasFfmpeg() ? describe : describe.skip

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

/** A tiny real webm, so the transcode path is genuinely exercised. */
function makeWebm(path: string) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10:duration=1', path])
}

suite('BrowserRecorder', () => {
  const setup = () => {
    const runDir = mkdtempSync(join(tmpdir(), 'swe-verify-rec-'))
    const videoDir = join(runDir, 'raw')
    execFileSync('mkdir', ['-p', videoDir])
    const raw = join(videoDir, 'take.webm')
    makeWebm(raw)
    const store = new ArtifactStore({
      runDir,
      policy: compileRedactionPolicy(DEFAULT_CONFIG.redact),
      budgetBytes: 50_000_000,
    })
    const source = { videoDir: () => videoDir, recordedVideo: () => raw, finish: async () => {} }
    return { runDir, store, source }
  }

  it('declares that it produces video', () => {
    const { store, source } = setup()
    expect(new BrowserRecorder({ source, store }).produces).toContain('video')
  })

  it('turns the raw take into an mp4 artefact the story can carry', async () => {
    const { runDir, store, source } = setup()
    const recorder = new BrowserRecorder({ source, store })
    await recorder.start(ctx(runDir))
    await recorder.mark({ seq: 1, driver: 'web', action: 'goto' })
    const artifacts = await recorder.stop()

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]!.kind).toBe('video')
    expect(artifacts[0]!.path).toMatch(/^artifacts\/video\/run\.mp4$/)
    expect(existsSync(join(runDir, artifacts[0]!.path))).toBe(true)
  })

  it('declares who can read it — a video is for the human', async () => {
    const { runDir, store, source } = setup()
    const recorder = new BrowserRecorder({ source, store })
    await recorder.start(ctx(runDir))
    const [artifact] = await recorder.stop()
    expect(artifact!.readableBy).toEqual(['human'])
  })

  it('records which steps the recording spans', async () => {
    const { runDir, store, source } = setup()
    const recorder = new BrowserRecorder({ source, store })
    await recorder.start(ctx(runDir))
    await recorder.mark({ seq: 1, driver: 'web', action: 'goto' })
    await recorder.mark({ seq: 2, driver: 'web', action: 'click' })
    await recorder.stop()
    expect(recorder.markedSteps().map((s) => s.seq)).toEqual([1, 2])
  })

  it('splices a title card in front rather than drawing on the app', async () => {
    const { runDir, store, source } = setup()
    let renderedAt: { w: number; h: number } | null = null
    const recorder = new BrowserRecorder({
      source,
      store,
      card: { title: 'A firing alert' },
      width: 320,
      height: 240,
      renderCard: async (_card, png, w, h) => {
        renderedAt = { w, h }
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=navy:size=${w}x${h}`, '-frames:v', '1', png])
      },
    })
    await recorder.start(ctx(runDir))
    const [artifact] = await recorder.stop()
    expect(renderedAt).toEqual({ w: 320, h: 240 })
    // The card adds ~4s in front of a 1s clip.
    const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(runDir, artifact!.path)], { encoding: 'utf8' })
    expect(Number(probe.trim())).toBeGreaterThan(3)
  })

  it('says so, and returns nothing, when the run produced no take', async () => {
    const { runDir, store } = setup()
    const lines: string[] = []
    const recorder = new BrowserRecorder({ source: { videoDir: () => join(runDir, 'raw'), recordedVideo: () => null, finish: async () => {} }, store })
    await recorder.start({ ...ctx(runDir), log: (l) => lines.push(l) })
    expect(await recorder.stop()).toEqual([])
    expect(lines.join(' ')).toMatch(/no video/i)
  })
})
