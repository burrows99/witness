/**
 * Progress, for the minutes a run spends doing something.
 *
 * A run attaches a debugger, brings an app up, drives it, films it and
 * transcodes the film. That is minutes of wall clock during which the harness
 * knew exactly what it was doing and said none of it: `log()` wrote to
 * `.witness/runs/<id>/logs/harness.log`, which nobody is watching while they
 * wait. Silence and a hang look identical, and the usual response to a hang is
 * to kill it — which is how a run that was working gets reported as broken.
 *
 * One event type, two renderings. The CLI draws it on stderr; MCP forwards it
 * as `notifications/progress`. Neither invents its own idea of what a run is
 * doing, which is the same reason MCP shells out to the CLI rather than
 * reimplementing it (TDD §8.2).
 */

export interface ProgressEvent {
  /** Coarse stage, stable across runs: `instrument`, `steps`, `record`. */
  phase: string
  /**
   * Work done so far. Monotonic — MCP requires it, and a bar that goes
   * backwards reads as a bug in the thing being measured.
   */
  progress: number
  /** Total units, when it is known. Omitted rather than guessed. */
  total?: number
  /** One line a person can read. */
  message: string
}

export type ProgressSink = (event: ProgressEvent) => void

/** Discards everything. The default, so progress is opt-in for every caller. */
export const NO_PROGRESS: ProgressSink = () => {}

/**
 * Counts phases so callers do not have to thread a running total through every
 * layer, and refuses to go backwards.
 *
 * `total` can be revised upward mid-run — the step count is not known until
 * the plan is read, and the transcode is not known until recording is asked
 * for — but `progress` only ever climbs.
 */
export class ProgressReporter {
  private done = 0
  private total: number | undefined

  constructor(private readonly sink: ProgressSink = NO_PROGRESS, total?: number) {
    this.total = total
  }

  /** Revise the total upward once the run knows how much work it holds. */
  expect(total: number): void {
    if (this.total === undefined || total > this.total) this.total = total
  }

  /** One unit of work finished. */
  advance(phase: string, message: string): void {
    this.done += 1
    this.emit(phase, message)
  }

  /** Something worth saying that did not complete a unit. */
  note(phase: string, message: string): void {
    this.emit(phase, message)
  }

  private emit(phase: string, message: string): void {
    // Clamped: a run that does more than it expected reports "at the end"
    // rather than 11/10, which reads as a counting bug rather than a busy run.
    const progress = this.total === undefined ? this.done : Math.min(this.done, this.total)
    this.sink({
      phase,
      progress,
      ...(this.total === undefined ? {} : { total: this.total }),
      message,
    })
  }
}

export interface RenderOptions {
  /** Where the drawing goes. Never stdout: `--json` owns that. */
  stderr: NodeJS.WritableStream
  /** Redraw in place when true, one line per event when false. */
  tty: boolean
  /** Suppress colour. */
  colour: boolean
}

/**
 * Render to stderr, never stdout.
 *
 * stdout carries the verdict an agent parses, so progress cannot go there
 * without corrupting it — and the reason `--json` is trustworthy at all is
 * that nothing else is allowed on that stream.
 *
 * On a TTY the line is redrawn in place. Off one it is printed whole, because
 * a carriage return in a CI log leaves the whole run on a single unreadable
 * line — the thing that makes people turn progress output off.
 */
export function renderProgress(options: RenderOptions): ProgressSink {
  let lastWidth = 0
  return (event) => {
    const counted = event.total === undefined
      ? `${event.progress}`
      : `${event.progress}/${event.total}`
    const percent = event.total !== undefined && event.total > 0
      ? ` ${Math.round((event.progress / event.total) * 100)}%`
      : ''
    const body = `${event.phase} ${counted}${percent}  ${event.message}`

    if (!options.tty) {
      options.stderr.write(`${body}\n`)
      return
    }
    const dim = options.colour ? '\u001b[2m' : ''
    const reset = options.colour ? '\u001b[0m' : ''
    // Pad to the previous width so a shorter line does not leave the tail of
    // the longer one behind it.
    const padding = ' '.repeat(Math.max(0, lastWidth - body.length))
    lastWidth = body.length
    options.stderr.write(`\r${dim}${body}${reset}${padding}`)
  }
}

/** Clear a redrawn line, so the verdict does not print onto the last frame. */
export function clearProgress(options: Pick<RenderOptions, 'stderr' | 'tty'>): void {
  if (options.tty) options.stderr.write('\r\u001b[K')
}

/**
 * Whether to draw at all.
 *
 * `NO_COLOR` and `TERM=dumb` are the two conventions a terminal has for saying
 * it cannot take escape sequences, and both are honoured for colour rather
 * than for progress itself: a dumb terminal still deserves to know the run is
 * alive, it just gets plain lines.
 */
export function progressStyle(stderr: NodeJS.WritableStream, env: Record<string, string | undefined>): { tty: boolean; colour: boolean } {
  const tty = Boolean((stderr as Partial<NodeJS.WriteStream>).isTTY)
  const colour = tty && !env.NO_COLOR && env.TERM !== 'dumb'
  return { tty, colour }
}
