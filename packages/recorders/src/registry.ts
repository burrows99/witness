import { join } from 'node:path'
import type { Recorder } from '@swe-verify/core'
import type { ArtifactStore } from './store.js'
import { BrowserRecorder, type BrowserSource } from './browser.js'
import { TerminalRecorder, type TerminalSource } from './terminal-recorder.js'
import type { Slide } from './video.js'

/**
 * The registry — the only way a runner obtains a recorder.
 *
 * Without this the runner has to name an implementation, which means adding a
 * recorder means editing the runner, and the runner ends up knowing that
 * Playwright writes a webm into a directory it must also thread through the
 * driver factory. That is the coupling the seam exists to prevent.
 *
 * So: one deps bag every recorder is offered, and each decides whether the
 * inputs it needs are present. A run with no web driver gets no browser
 * recorder, and that is a `null` rather than a throw — the recorder is
 * inapplicable to that run, not broken.
 */

export const RECORDERS = ['browser', 'terminal'] as const
export type RecorderName = (typeof RECORDERS)[number]

export interface RecorderDeps {
  /** Where this run's working files go; each recorder gets its own subdirectory. */
  runDir: string
  store: ArtifactStore
  /** Present when a driver is holding a browser context that is being recorded. */
  browser?: BrowserSource
  /** Present when the run has commands to film. */
  terminal?: TerminalSource
  /** Spliced in front of the clip as a card — never typed into the app or the shell. */
  card?: Slide
  renderCard?: (card: Slide, png: string, width: number, height: number) => Promise<void>
  width?: number
  height?: number
}

/**
 * Build one recorder, or `null` when this run does not have what it needs.
 * Throws only for a name this build does not ship — a silent no-op there
 * would mean a typo in a config produced a run that recorded nothing.
 */
export function createRecorder(name: RecorderName, deps: RecorderDeps): Recorder | null {
  switch (name) {
    case 'browser': {
      if (!deps.browser) return null
      return new BrowserRecorder({
        source: deps.browser,
        store: deps.store,
        card: deps.card,
        renderCard: deps.renderCard,
        width: deps.width ?? 1280,
        height: deps.height ?? 720,
      })
    }
    case 'terminal': {
      if (!deps.terminal || deps.terminal.steps.length === 0) return null
      return new TerminalRecorder({
        source: deps.terminal,
        store: deps.store,
        workDir: join(deps.runDir, 'raw-terminal'),
      })
    }
    default: {
      const unknown: never = name
      throw new Error(`no recorder named "${String(unknown)}" in this build; known: ${RECORDERS.join(', ')}`)
    }
  }
}

/** Every recorder applicable to this run, in registry order. */
export function createRecorders(deps: RecorderDeps): Recorder[] {
  const built: Recorder[] = []
  for (const name of RECORDERS) {
    const recorder = createRecorder(name, deps)
    if (recorder) built.push(recorder)
  }
  return built
}
