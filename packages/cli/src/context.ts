import { relative } from 'node:path'
import type { ResolvedConfig } from '@witness/core'
import type { Args } from './args.js'
import { resolveBrand, type Brand } from '@witness/core'
import { repoRoot as repoRootOf } from './git.js'

export interface DoctorCheck {
  name: string
  status: 'ok' | 'warn' | 'error'
  detail: string
  remedy?: string
}

export interface CommandContext {
  args: Args
  cwd: string
  /**
   * The git root. Every path in a run — diff paths, scope globs, probe files,
   * fixture programs — is relative to this and nothing else. `cwd` only says
   * which repository to work in; letting it also be the path base is what
   * made the same plan resolve two different ways.
   */
  repoRoot: string
  /**
   * The name this tool is running under, resolved from the invocation's own
   * environment. On the context rather than a module constant because the CLI
   * is embeddable and the test suite drives it in-process: one brand fixed at
   * import would ignore what a given invocation asked for.
   */
  brand: Brand
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
  // Resolved once: it shells out to git, and every path in the run leans on it.
  const root = repoRootOf(cwd)
  return {
    args,
    cwd,
    repoRoot: root,
    brand: resolveBrand(env),
    env,
    config,
    now,
    ci: Boolean(env.CI || env.GITHUB_ACTIONS || env.GITLAB_CI || env.BITBUCKET_BUILD_NUMBER),
    relative: (path: string) => relative(root, path) || path,
  }
}
