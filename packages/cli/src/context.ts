import { relative } from 'node:path'
import type { ResolvedConfig } from '@swe-verify/core'
import type { Args } from './args.js'

export interface DoctorCheck {
  name: string
  status: 'ok' | 'warn' | 'error'
  detail: string
  remedy?: string
}

export interface CommandContext {
  args: Args
  cwd: string
  env: Record<string, string | undefined>
  config: ResolvedConfig
  now: Date
  ci: boolean
  relative(path: string): string
  /** Environment checks contributed by optional packages (probes, drivers). */
  extraChecks?: DoctorCheck[]
}

export interface CommandResult {
  exitCode: number
  /** Human-readable lines; suppressed entirely under --json. */
  text: string[]
  /**
   * Lines that belong on stderr: a non-zero outcome a human needs to see,
   * while stdout stays parseable for the agent reading --json.
   */
  stderrText?: string[]
  /** The machine read path. Never mixed with human output. */
  json: unknown
  /** What was published to the host, when a command publishes. */
  publish?: { lines: string[]; summaries: string[] }
}

export function makeContext(args: Args, config: ResolvedConfig, cwd: string, env: Record<string, string | undefined>, now = new Date()): CommandContext {
  return {
    args,
    cwd,
    env,
    config,
    now,
    ci: Boolean(env.CI || env.GITHUB_ACTIONS || env.GITLAB_CI || env.BITBUCKET_BUILD_NUMBER),
    relative: (path: string) => relative(cwd, path) || path,
  }
}
