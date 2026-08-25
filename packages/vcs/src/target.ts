import { appendFileSync } from 'node:fs'
import type { PublishTarget } from './types.js'

/** Writes provider output to a stream (stdout in practice). */
export class StreamTarget implements PublishTarget {
  constructor(private readonly out: NodeJS.WritableStream, private readonly summaryPath?: string) {}
  write(line: string): void { this.out.write(`${line}\n`) }
  summary(markdown: string): void {
    // GITHUB_STEP_SUMMARY / a local file. A failed write must not fail a run:
    // publishing is reporting, and reporting is not the verdict.
    if (!this.summaryPath) return
    try { appendFileSync(this.summaryPath, `${markdown}\n`) } catch { /* reporting is best-effort */ }
  }
}

/** Collects output in memory — used by tests and by `--json`. */
export class CollectTarget implements PublishTarget {
  readonly lines: string[] = []
  readonly summaries: string[] = []
  write(line: string): void { this.lines.push(line) }
  summary(markdown: string): void { this.summaries.push(markdown) }
}

/** The step-summary file for the host we are on, if any. */
export function ciTarget(env: Record<string, string | undefined>, out: NodeJS.WritableStream): StreamTarget {
  return new StreamTarget(out, env.GITHUB_STEP_SUMMARY)
}
