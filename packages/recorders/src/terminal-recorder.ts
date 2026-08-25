import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ArtifactKind, Recorder, RunContext, StepRef, StoryArtifact } from '@swe-verify/core'
import type { ArtifactStore } from './store.js'
import { hasVhs, recordTerminal, tapeSlides, type TerminalStep } from './terminal.js'

/**
 * The `terminal` recorder — VHS.
 *
 * Most backend changes have no screen, and a still frame of green test output
 * proves nothing about what it looked like before. This films the commands.
 *
 * VHS is file-driven rather than an API: the tape is generated, written and
 * handed to a subprocess. That difference stops here. A consumer sees the
 * same session — `start`, `mark`, `stop` — and gets back artefacts with
 * declared readers, exactly as it does from the Playwright recorder.
 *
 * It emits a transcript as well as the film, because the agent is the primary
 * user and cannot watch a video (SV030).
 */

export interface TerminalSource {
  steps: readonly TerminalStep[]
  cwd?: string
  env?: Record<string, string>
}

export interface TerminalRecorderOptions {
  source: TerminalSource
  store: ArtifactStore
  /** Where the tape, the film and the transcript are written. */
  workDir: string
  timeoutMs?: number
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

  /** The captions, for the caller to splice as cards — never typed into the shell. */
  slides(): string[] {
    return tapeSlides({ steps: this.options.source.steps })
  }

  async stop(): Promise<StoryArtifact[]> {
    if (this.stopped) return []
    this.stopped = true

    if (this.options.source.steps.length === 0) return []
    if (!hasVhs()) {
      // Degrade rather than fail the run: losing the film is not losing the
      // gate, and the verdict must still be reachable.
      this.ctx?.log('terminal recorder: vhs not found, no terminal recording made')
      return []
    }

    const work = this.options.workDir
    const video = join(work, 'terminal.mp4')
    const transcript = join(work, 'terminal.txt')
    const tapePath = join(work, 'session.tape')

    try {
      await recordTerminal({
        tapePath,
        output: video,
        transcript,
        steps: [...this.options.source.steps],
        ...(this.options.source.cwd ? { cwd: this.options.source.cwd } : {}),
        ...(this.options.source.env ? { env: this.options.source.env } : {}),
        ...(this.options.timeoutMs !== undefined ? { timeoutMs: this.options.timeoutMs } : {}),
      })
    } catch (error) {
      this.ctx?.log(`terminal recorder: vhs failed, no terminal recording made: ${(error as Error).message}`)
      return []
    }

    const artifacts: StoryArtifact[] = []
    if (existsSync(video)) {
      const adopted = this.options.store.adopt({ kind: 'video', name: 'video/terminal.mp4', readableBy: ['human'] }, video)
      if (adopted) artifacts.push(adopted)
    }
    if (existsSync(transcript)) {
      const adopted = this.options.store.adopt(
        { kind: 'transcript', name: 'transcript/terminal.txt', readableBy: ['agent'] },
        transcript,
      )
      if (adopted) artifacts.push(adopted)
    }
    return artifacts
  }

  markedSteps(): readonly StepRef[] {
    return this.marks
  }
}
