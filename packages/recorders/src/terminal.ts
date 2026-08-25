import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync } from 'node:fs'

/**
 * A terminal recording, for work with no user interface.
 *
 * Most backend changes have no screen. What a reviewer needs to see is a test
 * failing, then the same test passing — and a still frame of green output
 * proves nothing about what it looked like before.
 *
 * Narration is NOT typed into the shell. A caption written as a `# comment`
 * pollutes the only frame that is meant to be evidence — a viewer can no
 * longer separate the tool's commentary from the program's own output. The
 * terminal shows commands and their output, nothing else; captions are
 * returned for the caller to render as spliced cards (see `splice.ts`).
 *
 * The recorder also owes an agent-readable transcript. A video is unreadable
 * to the primary user of this system, so a run that produces only an mp4 has
 * produced no evidence an agent can check (TDD §7.4, FR-15).
 */

const run = promisify(execFile)

export interface TerminalStep {
  /** Narration, typed as a comment line before the command runs. */
  caption?: string
  command: string
  /** How long the command may take before the recording moves on. */
  waitMs?: number
}

export interface TapeOptions {
  output: string
  steps: TerminalStep[]
  /** Where the session's plain text is written — the agent-readable artefact. */
  transcript?: string
  cwd?: string
  /** Extra environment for the recorded shell. */
  env?: Record<string, string>
  width?: number
  height?: number
  fontSize?: number
  /** Hold on the final frame so the last output can be read. */
  holdMs?: number
}

/**
 * Environment that keeps a recorded shell non-interactive. Each entry is here
 * because something opened a pager or waited for a keypress mid-recording.
 */
const PAGERLESS: Record<string, string> = {
  PAGER: 'cat',
  GIT_PAGER: 'cat',
  LESS: 'FRX',
  GH_PAGER: 'cat',
  // Colour survives; a prompt for input does not.
  GIT_TERMINAL_PROMPT: '0',
  CLICOLOR_FORCE: '1',
}

/** The captions, in order, for the caller to render as cards. */
export function tapeSlides(options: { steps: readonly TerminalStep[] }): string[] {
  return options.steps.map((step) => step.caption).filter((caption): caption is string => Boolean(caption))
}

export function hasVhs(): boolean {
  try {
    execFileSync('vhs', ['--version'], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

/** VHS types a string literally, so a backtick or quote has to be escaped. */
function typeLiteral(text: string): string {
  return `Type "${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`')}"`
}

function wait(ms: number): string {
  return ms >= 1000 ? `Sleep ${Math.round(ms / 1000)}s` : `Sleep ${ms}ms`
}

export function renderTape(options: TapeOptions): string {
  const lines: string[] = [
    // Quoted: VHS's parser splits an unquoted absolute path on `/` and reports
    // each segment as an unknown command.
    `Output "${options.output}"`,
    '',
    // Wide enough that `go test` output does not wrap, which is what makes a
    // failure unreadable in a recording.
    `Set Width ${options.width ?? 1400}`,
    `Set Height ${options.height ?? 800}`,
    `Set FontSize ${options.fontSize ?? 16}`,
    'Set Padding 24',
    'Set Theme "Catppuccin Mocha"',
    'Set TypingSpeed 12ms',
    '',
    // A pager is fatal to a recording: `git log` opens `less`, swallows every
    // command typed after it, and the film ends on "Pattern not found" having
    // never run the thing it was made to show. Nothing interactive may start.
    ...Object.entries({ ...PAGERLESS, ...options.env }).map(([key, value]) => `Env ${key} "${value}"`),
    '',
  ]

  // Setup is real but not evidence: `cd`, and the transcript capture, happen
  // behind `Hide` so the recorded frame carries only the commands a reader is
  // meant to judge. A `| tee /Users/.../session.txt` on every line is noise,
  // and it leaks a local path into the film.
  const setup: string[] = []
  if (options.cwd) setup.push(`cd ${options.cwd}`)
  // `script` captures the whole session, so no command has to be rewritten.
  // It starts a *new* shell, so the wipe has to come after it — clearing
  // first leaves the `script` invocation and any shell banner on screen.
  if (options.transcript) setup.push(`script -q ${options.transcript}`)
  if (setup.length > 0) setup.push('clear')

  if (setup.length > 0) {
    lines.push('Hide')
    for (const command of setup) lines.push(typeLiteral(command), 'Enter', 'Sleep 500ms')
    lines.push('Show', '')
  }

  for (const step of options.steps) {
    // Only the command is typed. Its caption is rendered as a card and
    // spliced in front of the clip by the caller.
    lines.push(typeLiteral(step.command), 'Enter', wait(step.waitMs ?? 8_000), '')
  }

  lines.push(wait(options.holdMs ?? 2_500))
  // Close the transcript off-camera too.
  if (options.transcript) lines.push('Hide', typeLiteral('exit'), 'Enter', 'Sleep 500ms', 'Show')
  return `${lines.join('\n')}\n`
}

export interface RecordTerminalOptions extends TapeOptions {
  tapePath: string
  timeoutMs?: number
}

export async function recordTerminal(options: RecordTerminalOptions): Promise<void> {
  writeFileSync(options.tapePath, renderTape(options))
  await run('vhs', [options.tapePath], {
    timeout: options.timeoutMs ?? 900_000,
    maxBuffer: 32 * 1024 * 1024,
  })
}
