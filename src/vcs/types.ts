import type { Bypass, GateResult } from '../core/index.js'

export type ProviderName = 'local' | 'github' | 'gitlab' | 'bitbucket'
export type ProviderSelector = ProviderName | 'auto'

/** Process environment, injected so providers stay testable and pure-ish. */
export type VcsEnv = Record<string, string | undefined>

export interface ChangeContext {
  provider: ProviderName
  changeId?: string
  actor?: string
  branch?: string
  repo?: string
}

/**
 * Where a published result goes. Injected so the contract suite can assert on
 * what a provider *said* without a host, a token or a network.
 */
export interface PublishTarget {
  /** One line of provider-native output (a workflow command, or plain text). */
  write(line: string): void
  /** A block of markdown for a job summary / MR note, where the host has one. */
  summary(markdown: string): void
}

export interface ProviderOptions {
  env: VcsEnv
  /** `--bypass "<reason>"`, the local escape hatch and the override everywhere. */
  bypassReason?: string
  /** Label that signals a bypass on hosts that have labels. */
  bypassLabel?: string
}

/**
 * Three operations, and only three. Coupling risk exists exactly where a
 * *host* is touched: learning the change context, reading a bypass signal,
 * and publishing a result. Everything else — `git diff`, `git merge-base` —
 * is a local tool, not a host, and stays outside this interface (TDD §7.7).
 */
export interface VcsProvider {
  readonly name: ProviderName
  describe(): Promise<ChangeContext>
  resolveBypass(): Promise<Bypass | null>
  publish(result: GateResult, target: PublishTarget): Promise<void>
}
