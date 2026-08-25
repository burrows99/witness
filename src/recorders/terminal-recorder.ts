import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import type { ArtifactKind, Recorder, RunContext, StepRef, StoryArtifact } from '../core/index.js'
import type { ArtifactStore } from './store.js'
import { hasVhs, renderTape, stripTerminalControl, type TerminalStep } from './terminal.js'
import { hasFfmpeg, slideDocument, type Slide } from './video.js'
import { concatArgs, concatList, slideClipArgs } from './splice.js'

/**
 * The `terminal` recorder — VHS.
 *
 * Most backend changes have no screen, and a still frame of green test output
 * proves nothing about what it looked like before. This films the commands.
 *
 * VHS is file-driven rather than an API: a tape is generated, written and
 * handed to a subprocess. That difference stops at this boundary — a consumer
 * sees the same `start` / `mark` / `stop` session it gets from the Playwright
 * recorder, and takes back artefacts with declared readers.
 *
 * **One tape per beat.** A single tape covering every command would give one
 * clip, and the only place left for narration would be the front, as a
 * preamble — or worse, typed into the shell as `# comments`, which is what
 * ruined an earlier recording: a reader could no longer tell the tool's
 * commentary from the program's own output. Filming each command separately
 * costs a VHS start-up per beat and buys a card that sits with the command it
 * describes. Each tape is its own shell, so beats must be independent
 * commands rather than a session that accumulates state.
 */

export interface TerminalSource {
  steps: readonly TerminalStep[]
  cwd?: string
  env?: Record<string, string>
}

export interface TerminalRecorderOptions {
  source: TerminalSource
  store: ArtifactStore
  /** Where tapes, clips, cards and the transcript are written. */
  workDir: string
  width?: number
  height?: number
  timeoutMs?: number
  /** Renders a caption card to a still at the given geometry. */
  renderStill?: ((card: Slide, png: string, width: number, height: number) => Promise<void>) | undefined
  /** Overridable so the wiring can be tested without VHS or ffmpeg present. */
  hasTool?: (tool: 'vhs' | 'ffmpeg') => boolean
  run?: (file: string, args: string[]) => Promise<unknown>
}

/** One command, its narration, and the files this recorder will write for it. */
export interface TerminalBeat {
  index: number
  caption?: string | undefined
  step: TerminalStep
  tapePath: string
  clipPath: string
  transcriptPath: string
}

export class TerminalRecorder implements Recorder {
  readonly name = 'terminal'
  readonly produces: readonly ArtifactKind[] = ['video', 'transcript']

  private marks: StepRef[] = []
  private ctx: RunContext | null = null
  private stopped = false

  constructor(private readonly options: TerminalRecorderOptions) {}

  async start(ctx: RunContext): Promise<void> {
    this.ctx = ctx
    mkdirSync(this.options.workDir, { recursive: true })
  }

  async mark(step: StepRef): Promise<void> {
    this.marks.push(step)
  }

  /** The beats this recording is made of, in order. */
  beats(): TerminalBeat[] {
    const pad = (n: number) => String(n).padStart(3, '0')
    return this.options.source.steps.map((step, index) => ({
      index,
      caption: step.caption,
      step,
      tapePath: join(this.options.workDir, `beat-${pad(index)}.tape`),
      clipPath: join(this.options.workDir, `beat-${pad(index)}.mp4`),
      transcriptPath: join(this.options.workDir, `beat-${pad(index)}.txt`),
    }))
  }

  /** Materialise every tape. Separated so the generated text can be inspected. */
  writeTapes(): TerminalBeat[] {
    const beats = this.beats()
    for (const beat of beats) {
      writeFileSync(
        beat.tapePath,
        renderTape({
          output: beat.clipPath,
          // Only the command is typed. The caption becomes a card.
          steps: [beat.step],
          transcript: beat.transcriptPath,
          ...(this.options.source.cwd ? { cwd: this.options.source.cwd } : {}),
          ...(this.options.source.env ? { env: this.options.source.env } : {}),
          width: this.options.width ?? 1500,
          height: this.options.height ?? 820,
        }),
      )
    }
    return beats
  }

  async stop(): Promise<StoryArtifact[]> {
    if (this.stopped) return []
    this.stopped = true

    const beats = this.beats()
    if (beats.length === 0) return []

    const has = this.options.hasTool ?? ((tool) => (tool === 'vhs' ? hasVhs() : hasFfmpeg()))
    if (!has('vhs')) {
      // Degrade rather than fail the run — losing the film is not losing the
      // gate — but say so, because a recording that vanishes silently is the
      // failure this whole layer exists to prevent.
      this.ctx?.log('terminal recorder: vhs is not installed, so no terminal recording was made')
      return []
    }

    const run = this.options.run ?? defaultRun
    const width = this.options.width ?? 1500
    const height = this.options.height ?? 820
    this.writeTapes()

    const parts: string[] = []
    for (const beat of beats) {
      try {
        await run('vhs', [beat.tapePath])
      } catch (error) {
        this.ctx?.log(`terminal recorder: beat ${beat.index + 1} failed to record: ${(error as Error).message}`)
        continue
      }
      if (!existsSync(beat.clipPath)) continue
      // The card goes in front of the beat it narrates, not in front of the
      // film: a reviewer scrubbing to a moment can then see which beat it is.
      if (beat.caption && has('ffmpeg')) {
        const card = await this.renderCard({ title: beat.caption }, beat.index, width, height, run)
        if (card) parts.push(card)
      } else if (beat.caption) {
        this.ctx?.log(`terminal recorder: ffmpeg is not installed, so the caption "${beat.caption}" was not rendered`)
      }
      parts.push(beat.clipPath)
    }

    if (parts.length === 0) {
      this.ctx?.log('terminal recorder: every beat failed to record')
      return []
    }

    const artifacts: StoryArtifact[] = []
    const video = await this.joinParts(parts, has, run)
    if (video) {
      const adopted = this.options.store.adopt({ kind: 'video', name: 'video/terminal.mp4', readableBy: ['human'] }, video)
      if (adopted) artifacts.push(adopted)
    }

    const transcript = this.joinTranscripts(beats)
    if (transcript !== null) {
      const written = this.options.store.writeText(
        { kind: 'transcript', name: 'transcript/terminal.txt', readableBy: ['agent'] },
        transcript,
      )
      if (written) artifacts.push(written)
    }
    return artifacts
  }

  /** Concatenate the beats, or hand back the single clip when there is one. */
  private async joinParts(
    parts: string[],
    has: (tool: 'vhs' | 'ffmpeg') => boolean,
    run: (file: string, args: string[]) => Promise<unknown>,
  ): Promise<string | null> {
    if (parts.length === 1) return parts[0]!
    if (!has('ffmpeg')) {
      this.ctx?.log('terminal recorder: ffmpeg is not installed, so only the first beat was kept')
      return parts[0]!
    }
    const listFile = join(this.options.workDir, 'parts.txt')
    const output = join(this.options.workDir, 'terminal.mp4')
    writeFileSync(listFile, concatList(parts))
    try {
      await run('ffmpeg', concatArgs({ listFile, output }))
    } catch (error) {
      this.ctx?.log(`terminal recorder: the beats could not be joined: ${(error as Error).message}`)
      return parts[0]!
    }
    return existsSync(output) ? output : null
  }

  private async renderCard(
    card: Slide,
    index: number,
    width: number,
    height: number,
    run: (file: string, args: string[]) => Promise<unknown>,
  ): Promise<string | null> {
    const html = join(this.options.workDir, `card-${index}.html`)
    const png = join(this.options.workDir, `card-${index}.png`)
    const clip = join(this.options.workDir, `card-${index}.mp4`)
    writeFileSync(html, slideDocument(card, width, height))
    try {
      // A still is rendered by whatever the caller wired up; without one the
      // caption is reported as lost rather than dropped in silence.
      const renderStill = this.options.renderStill
      if (!renderStill) {
        this.ctx?.log(`terminal recorder: no card renderer, so the caption "${card.title}" was not rendered`)
        return null
      }
      await renderStill(card, png, width, height)
      await run('ffmpeg', slideClipArgs({ image: png, output: clip, seconds: 3, width, height }))
    } catch (error) {
      this.ctx?.log(`terminal recorder: the card for "${card.title}" failed: ${(error as Error).message}`)
      return null
    }
    return existsSync(clip) ? clip : null
  }

  /** The whole session as text, for the reader that cannot watch a video. */
  private joinTranscripts(beats: readonly TerminalBeat[]): string | null {
    const chunks: string[] = []
    for (const beat of beats) {
      if (!existsSync(beat.transcriptPath)) continue
      // The `clear` that wipes the setup runs inside the recorded session, so
      // it lands in the capture even though it is hidden in the film.
      const text = stripTerminalControl(readFileSync(beat.transcriptPath, 'utf8')).replace(/^clear\n+/, '')
      if (text.length === 0) continue
      chunks.push(beat.caption ? `### ${beat.caption}\n${text}` : text)
    }
    return chunks.length > 0 ? `${chunks.join('\n')}\n` : null
  }

  markedSteps(): readonly StepRef[] {
    return this.marks
  }
}

const execFileAsync = promisify(execFile)

async function defaultRun(file: string, args: string[]): Promise<unknown> {
  return await execFileAsync(file, args, { timeout: 900_000, maxBuffer: 32 * 1024 * 1024 })
}
