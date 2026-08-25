import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import type { ArtifactKind, Recorder, RunContext, StepRef, StoryArtifact } from '@swe-verify/core'
import type { ArtifactStore } from './store.js'
import { hasFfmpeg, transcodeToMp4 } from './video.js'
import { concatArgs, concatList, slideClipArgs } from './splice.js'
import type { Slide } from './video.js'

/**
 * The `browser` recorder — Playwright.
 *
 * A session, not a per-step callback: the video is one continuous file for the
 * whole run, and `mark` is what lets a moment inside it be tied back to a
 * step. The driver owns the page; this owns the evidence, which is why the
 * recording ends up in `story.artifacts` where the gate, the viewer and the
 * agent can all find it — rather than inside the driver where only the driver
 * can.
 */

export interface BrowserSource {
  /** Where Playwright is writing this run's `.webm`. */
  videoDir(): string
  /** The finished recording, available once the context has closed. */
  recordedVideo(): string | null
  /** Close the context so the recording is flushed. */
  finish(): Promise<void>
}

export interface BrowserRecorderOptions {
  source: BrowserSource
  store: ArtifactStore
  /** Rendered to a still and spliced in front of the clip. */
  card?: Slide | undefined
  /** Renders a card to a PNG at the given geometry. */
  renderCard?: ((card: Slide, png: string, width: number, height: number) => Promise<void>) | undefined
  width?: number
  height?: number
  run?: (file: string, args: string[]) => Promise<unknown>
}

export class BrowserRecorder implements Recorder {
  readonly name = 'browser'
  readonly produces: readonly ArtifactKind[] = ['video']

  private marks: StepRef[] = []
  private ctx: RunContext | null = null

  constructor(private readonly options: BrowserRecorderOptions) {}

  async start(ctx: RunContext): Promise<void> {
    this.ctx = ctx
    mkdirSync(this.options.source.videoDir(), { recursive: true })
  }

  async mark(step: StepRef): Promise<void> {
    this.marks.push(step)
  }

  async stop(): Promise<StoryArtifact[]> {
    await this.options.source.finish()
    const raw = this.options.source.recordedVideo()
    if (!raw || !existsSync(raw)) {
      this.ctx?.log('browser recorder: the run produced no video file')
      return []
    }

    const width = this.options.width ?? 1280
    const height = this.options.height ?? 720
    const work = this.options.source.videoDir()
    const run = this.options.run ?? defaultRun
    const clip = join(work, 'clip.mp4')

    if (!hasFfmpeg()) {
      // Degrade rather than lose the take: a webm is still evidence, it is
      // just less portable than the mp4 a reviewer can open on a phone.
      this.ctx?.log('browser recorder: ffmpeg not found, keeping the raw webm')
      const asIs = this.options.store.adopt({ kind: 'video', name: 'video/run.webm', readableBy: ['human'] }, raw)
      return asIs ? [asIs] : []
    }

    await transcodeToMp4({ input: raw, output: clip, holdLastFrameMs: 1200 })

    // The title card is spliced in as a card, never typed into the app: a
    // caption written into the page pollutes the only frame that is evidence.
    let finished = clip
    if (this.options.card && this.options.renderCard) {
      const png = join(work, 'card.png')
      const cardClip = join(work, 'card.mp4')
      await this.options.renderCard(this.options.card, png, width, height)
      await run('ffmpeg', slideClipArgs({ image: png, output: cardClip, seconds: 4, width, height }))
      const listFile = join(work, 'parts.txt')
      writeFileSync(listFile, concatList([cardClip, clip]))
      finished = join(work, 'final.mp4')
      await run('ffmpeg', concatArgs({ listFile, output: finished }))
    }

    const artifact = this.options.store.adopt(
      { kind: 'video', name: 'video/run.mp4', readableBy: ['human'] },
      finished,
    )
    return artifact ? [artifact] : []
  }

  /** Which steps this recording covers, for the story to reference. */
  markedSteps(): readonly StepRef[] {
    return this.marks
  }
}

const execFileAsync = promisify(execFile)

async function defaultRun(file: string, args: string[]): Promise<unknown> {
  return await execFileAsync(file, args, { timeout: 300_000, maxBuffer: 32 * 1024 * 1024 })
}
